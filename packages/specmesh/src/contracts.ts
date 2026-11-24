import Parser from "@apidevtools/swagger-parser";
import YAML from "yaml";
import { fail, hash } from "./model.ts";
export function parseDocument(input: unknown): Record<string, any> {
  let doc: any;
  try {
    doc =
      typeof input === "string"
        ? YAML.parse(input, { maxAliasCount: 0 })
        : structuredClone(input);
  } catch {
    fail("Invalid JSON/YAML. YAML aliases are not supported.");
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc))
    fail("Expected an OpenAPI object.");
  function scan(value: any, depth = 0) {
    if (depth > 60) fail("Schema nesting is too deep.");
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key))
        fail("Unsafe schema key.");
      if (
        (key === "$ref" || key === "$dynamicRef") &&
        (typeof item !== "string" || !item.startsWith("#/"))
      )
        fail(
          "Bundle contracts first. External file and URL references are disabled.",
        );
      scan(item, depth + 1);
    }
  }
  scan(doc);
  if (!/^3\.1\./.test(doc.openapi || "")) fail("Use an OpenAPI 3.1 document.");
  return doc;
}
export async function validateDocument(input: unknown) {
  const document = parseDocument(input);
  try {
    await Parser.validate(
      structuredClone(document) as any,
      { resolve: { external: false, file: false, http: false } } as any,
    );
    const errors: string[] = [];
    for (const [route, item] of Object.entries<any>(document.paths || {}))
      for (const [method, operation] of Object.entries<any>(item)) {
        if (
          [
            "get",
            "post",
            "put",
            "patch",
            "delete",
            "head",
            "options",
            "trace",
          ].includes(method) &&
          (!operation.responses || !Object.keys(operation.responses).length)
        )
          errors.push(
            `${method.toUpperCase()} ${route} must define explicit response semantics.`,
          );
      }
    return { document, errors };
  } catch (error) {
    return {
      document,
      errors: [
        error instanceof Error ? error.message : "Invalid OpenAPI document",
      ],
    };
  }
}
export function compareContracts(
  before: Record<string, any>,
  after: Record<string, any>,
) {
  const findings: {
    path: string;
    severity: "BREAKING" | "MANUAL_REVIEW";
    message: string;
  }[] = [];
  const add = (
    path: string,
    severity: "BREAKING" | "MANUAL_REVIEW",
    message: string,
  ) => findings.push({ path, severity, message });
  function walk(a: any, b: any, p: string) {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (a === undefined) {
      add(
        p,
        "MANUAL_REVIEW",
        "Added definition; review behavior and consumer expectations.",
      );
      return;
    }
    if (b === undefined) {
      add(
        p,
        p.startsWith("/paths/") || p.includes("/properties/")
          ? "BREAKING"
          : "MANUAL_REVIEW",
        "Definition removed.",
      );
      return;
    }
    if (p.endsWith("/type") || p.endsWith("/format")) {
      add(p, "BREAKING", "Schema type or format changed.");
      return;
    }
    if (p.endsWith("/required") && Array.isArray(a) && Array.isArray(b)) {
      const request = p.includes("/requestBody/") || p.includes("/parameters/");
      const response = p.includes("/responses/");
      if (
        (request && b.some((x) => !a.includes(x))) ||
        (response && a.some((x) => !b.includes(x)))
      )
        add(p, "BREAKING", "Required-field guarantee changed incompatibly.");
      else
        add(
          p,
          "MANUAL_REVIEW",
          "Required fields changed; inspect all schema uses.",
        );
      return;
    }
    if (
      typeof a !== "object" ||
      typeof b !== "object" ||
      a === null ||
      b === null ||
      Array.isArray(a) ||
      Array.isArray(b)
    ) {
      add(
        p,
        "MANUAL_REVIEW",
        "Value changed; semantic compatibility needs review.",
      );
      return;
    }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      // These are annotations only on an object, not names inside a schema
      // property or reusable-component map.
      const namedDefinitions = /\/(?:properties|patternProperties|\$defs|definitions|dependentSchemas)$/.test(p) || /^\/components\/[^/]+$/.test(p);
      if (!namedDefinitions && ["description", "summary", "example", "examples"].includes(k))
        continue;
      walk(a[k], b[k], p + "/" + k);
    }
  }
  const a = structuredClone(before),
    b = structuredClone(after);
  delete a.info;
  delete b.info;
  walk(a, b, "");
  return {
    status: findings.some((f) => f.severity === "BREAKING")
      ? "BREAKING"
      : findings.length
        ? "MANUAL_REVIEW"
        : hash(before) === hash(after)
          ? "UNCHANGED"
          : "MANUAL_REVIEW",
    findings,
    coverage:
      "Structural OpenAPI checks. Business semantics, authentication, schema composition and constraints require human review.",
  };
}
