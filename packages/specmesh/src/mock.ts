import Fastify from "fastify";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import Parser from "@apidevtools/swagger-parser";
import { fail, hash } from "./model.ts";
import type { ContractRecord } from "./model.ts";
import { validateDocument } from "./contracts.ts";

export async function startMock(contract: ContractRecord, port = 0) {
  if (contract.status !== "APPROVED")
    fail("Mocks require an approved contract.");
  if (hash(contract.document) !== contract.hash)
    fail("Contract content does not match its approved hash.");
  const valid = await validateDocument(contract.document);
  if (valid.errors.length) fail("Contract is invalid.");
  const doc: any = await Parser.dereference(
    structuredClone(contract.document) as any,
    {
      resolve: { external: false, file: false, http: false },
      dereference: { circular: false },
    } as any,
  );
  const Ajv = (Ajv2020 as any).default || Ajv2020,
    formats = (addFormats as any).default || addFormats;
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    validateFormats: true,
  });
  formats(ajv);
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  app.addHook("onRequest", async (_r, reply) => {
    reply.header("x-specmesh-mock", "simulated");
    reply.header("cache-control", "no-store");
  });
  let operationCount = 0;
  try {
    for (const [route, item] of Object.entries<any>(doc.paths || {}))
      for (const [method, operation] of Object.entries<any>(item)) {
        if (
          ![
            "get",
            "post",
            "put",
            "patch",
            "delete",
            "head",
            "options",
          ].includes(method)
        )
          continue;
        if (
          operation.callbacks ||
          Object.values<any>(operation.requestBody?.content || {}).length > 1
        )
          fail("Mock supports JSON request bodies without callbacks.");
        const request = operation.requestBody?.content?.["application/json"];
        if (operation.requestBody && !request)
          fail("Mock supports application/json request bodies only.");
        const bodyValidate = request ? ajv.compile(request.schema || {}) : null;
        const parameterMap = new Map<string, any>();
        for (const p of [
          ...(item.parameters || []),
          ...(operation.parameters || []),
        ]) parameterMap.set(`${p.in}:${p.in === "header" ? p.name.toLowerCase() : p.name}`, p);
        const parameters = [...parameterMap.values()].map((p: any) => ({ ...p, validate: ajv.compile(p.schema || {}) }));
        if (
          parameters.some(
            (p: any) => !["path", "query", "header"].includes(p.in),
          )
        )
          fail("Mock supports path, query, and header parameters.");
        const responses = new Map<string, { example: any; json: boolean }>();
        for (const [code, response] of Object.entries<any>(
          operation.responses || {},
        )) {
          if (!/^\d{3}$/.test(code)) continue;
          const media = response.content?.["application/json"];
          if (!media) {
            if (response.content) fail("Mock supports JSON responses only.");
            responses.set(code, { example: undefined, json: false });
            continue;
          }
          const example = Object.hasOwn(media, "example")
            ? media.example : Object.values<any>(media.examples || {})[0]?.value;
          if (example === undefined)
            fail(
              `Add an explicit JSON example for ${method.toUpperCase()} ${route} response ${code}.`,
            );
          if (!ajv.compile(media.schema || {})(example))
            fail(
              `Response example violates its schema: ${method.toUpperCase()} ${route} ${code}.`,
            );
          responses.set(code, { example, json: true });
        }
        const success = [...responses.keys()].find((k) => /^2/.test(k));
        if (!success)
          fail("Mock requires an explicit success response and example.");
        const security = operation.security ?? doc.security ?? [];
        const requiresAuthentication = security.length > 0 && !security.some((s: any) => Object.keys(s).length === 0);
        if (
          security.some((s: any) =>
            Object.keys(s).some((k) => {
              const rule = doc.components?.securitySchemes?.[k];
              return !rule || rule.type !== "http" || rule.scheme !== "bearer";
            }),
          )
        )
          fail(
            "Mock supports bearer-presence simulation only. Other authentication needs an external mock.",
          );
        operationCount++;
        if ((parameters.length || request) && !responses.has("422"))
          fail(
            "Document an explicit 422 validation-error example to use this mock.",
          );
        if (requiresAuthentication && !responses.has("401"))
          fail("Document an explicit 401 example to simulate authentication.");
        app.route({
          method: method.toUpperCase() as any,
          url: route.replace(/\{([^}]+)\}/g, ":$1"),
          handler: async (r, reply) => {
            const send = (code: string) => {
              const response = responses.get(code);
              if (response) {
                reply.code(Number(code));
                return response.json
                  ? reply.type("application/json").send(JSON.stringify(response.example))
                  : reply.send();
              }
              return reply
                    .code(Number(code))
                    .send({ error: "Simulated request rejected", mock: true });
            };
            if (
              requiresAuthentication &&
              !/^Bearer\s+\S+/i.test(r.headers.authorization || "")
            )
              return send("401");
            for (const p of parameters) {
              const values: any =
                p.in === "path"
                  ? r.params
                  : p.in === "query"
                    ? r.query
                    : r.headers;
              let value =
                values[p.in === "header" ? p.name.toLowerCase() : p.name];
              if (value === undefined) {
                if (p.required) return send("422");
                continue;
              }
              if (p.schema?.type === "integer" || p.schema?.type === "number")
                value = Number(value);
              if (p.schema?.type === "boolean")
                value =
                  value === "true" ? true : value === "false" ? false : value;
              if (!p.validate(value)) return send("422");
            }
            if (
              (operation.requestBody?.required && r.body === undefined) ||
              (r.body !== undefined && bodyValidate && !bodyValidate(r.body))
            )
              return send("422");
            const selected = String(r.headers["x-specmesh-status"] || success);
            if (!responses.has(selected))
              return reply.code(400).send({
                error: "Select a documented response status.",
                mock: true,
              });
            return send(selected);
          },
        });
      }
    if (!operationCount) fail("No mockable HTTP operations.");
    const url = await app.listen({ port, host: "127.0.0.1" });
    return {
      url,
      contractId: contract.id,
      version: contract.version,
      hash: contract.hash,
      simulated: true,
      close: () => app.close(),
    };
  } catch (error) {
    await app.close();
    throw error;
  }
}
