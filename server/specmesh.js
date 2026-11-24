import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { appConfig } from "./config.js";
import { member } from "./auth.js";
import {
  SpecMesh,
  manifest,
  impact,
  cycles,
  currentAnalysis,
  latestApproved,
  compareContracts,
} from "../packages/specmesh/src/core.ts";
import { sourceHash, fail } from "../packages/specmesh/src/model.ts";
import { bundle } from "../packages/specmesh/src/ai.ts";
import {
  demoFiles,
  demoProposal,
  demoContract,
} from "../packages/specmesh/src/demo.ts";

export function registerSpecMeshApi(app) {
  app.register(async (scoped) => {
    scoped.setErrorHandler((error, request, reply) => {
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "Input"}: ${issue.message}`).join("; ") });
      }
      if (error.statusCode >= 400 && error.statusCode < 500) return reply.code(error.statusCode).send({ error: error.message });
      return reply.send(error);
    });
    registerRoutes(scoped);
  });
}

function registerRoutes(app) {
  const base = () =>
    path.join(path.dirname(appConfig.dbPath), "specmesh-projects");
  const root = (key) => {
    if (!/^[a-f0-9-]{36}$/.test(key)) fail("Invalid project ID.");
    return path.join(base(), key);
  };
  function context(r, lead = false) {
    if (!r.user) fail("Sign in.", 401);
    const service = new SpecMesh(root(r.params.id)),
      state = service.read();
    if (state.project.teamId) member(r.user, state.project.teamId, lead);
    else if (state.project.ownerId !== r.user.id)
      fail("Project not found.", 404);
    return { service, state };
  }
  const view = (s) => ({
    ...s,
    sourceHash: sourceHash(s),
    analysisCurrent: currentAnalysis(s),
    cycles: cycles(s),
    readiness: s.stories.map((t) => manifest(s, t.id)),
    impacts: [
      ...new Set(
        s.analysis?.dependencies.map((d) => d.interfaceId).filter(Boolean) ||
          [],
      ),
    ].map((k) => impact(s, k)),
    comparisons: s.contracts
      .filter((c) => c.status !== "APPROVED")
      .map((c) => {
        const prior = latestApproved(s, c.id);
        return {
          id: c.id,
          version: c.version,
          result: prior ? compareContracts(prior.document, c.document) : null,
        };
      }),
  });
  app.get("/api/workspace/specmesh", async (r) => {
    if (!r.user) fail("Sign in.", 401);
    if (!fs.existsSync(base())) return [];
    const projects = [];
    for (const key of fs.readdirSync(base())) {
      if (!/^[a-f0-9-]{36}$/.test(key)) continue;
      const s = new SpecMesh(root(key)).read();
      try {
        if (s.project.teamId) member(r.user, s.project.teamId);
        else if (s.project.ownerId !== r.user.id) continue;
        projects.push({ ...s.project, key, stories: s.stories.length });
      } catch {}
    }
    return projects;
  });
  app.post("/api/workspace/specmesh", async (r) => {
    if (!r.user) fail("Sign in.", 401);
    const { name, teamId = "", demo = false } = r.body || {};
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 120 ||
      typeof teamId !== "string" ||
      typeof demo !== "boolean"
    )
      fail("Enter a project name.");
    if (teamId) member(r.user, teamId, true);
    const key = randomUUID(),
      service = new SpecMesh(root(key));
    service.store.init(name, r.user.id, teamId, demo);
    if (demo) {
      const s = service.import(demoFiles, r.user.id);
      service.analyze(demoProposal(s), "demo", sourceHash(s), r.user.id);
    }
    return { key };
  });
  app.get("/api/workspace/specmesh/:id", async (r) => view(context(r).state));
  app.post("/api/workspace/specmesh/:id/import", async (r) => {
    const { service } = context(r, true);
    return view(service.import(r.body?.files, r.user.id));
  });
  app.get("/api/workspace/specmesh/:id/context", async (r) =>
    bundle(context(r).state),
  );
  app.post("/api/workspace/specmesh/:id/proposals", async (r) => {
    const { service } = context(r, true);
    if (!["codex", "manual"].includes(r.body?.provider))
      fail("Choose codex or manual proposal provenance.");
    return view(
      service.analyze(
        r.body.proposal,
        r.body.provider,
        r.body.sourceHash,
        r.user.id,
      ),
    );
  });
  app.put("/api/workspace/specmesh/:id/dependencies/:key", async (r) => {
    const { service } = context(r, true);
    if (typeof r.body?.confirmed !== "boolean")
      fail("Choose confirm or reject.");
    return view(
      service.reviewDependency(r.params.key, r.body.confirmed, r.user.id),
    );
  });
  app.put("/api/workspace/specmesh/:id/decisions/:key", async (r) => {
    const { service } = context(r, true);
    return view(
      service.decide(
        r.params.key,
        r.body?.status,
        r.body?.resolution || "",
        r.user.id,
      ),
    );
  });
  app.put("/api/workspace/specmesh/:id/stories/:key", async (r) => {
    const { service } = context(r, true);
    return view(
      service.assign(
        r.params.key,
        r.body?.assignee || "",
        r.body?.service || "",
        r.user.id,
      ),
    );
  });
  app.post("/api/workspace/specmesh/:id/contracts", async (r) => {
    const { service } = context(r, true);
    return view(await service.draft(r.body, r.user.id));
  });
  app.post("/api/workspace/specmesh/:id/demo-contract", async (r) => {
    const { service, state } = context(r, true);
    demoProposal(state);
    const key = r.body?.interfaceId;
    const providers = {
      IdentityAPI: "US-1",
      BankAccountAPI: "US-2",
      TransferAPI: "US-3",
    };
    if (!providers[key]) fail("Select a sample API.");
    return view(
      await service.draft(
        {
          id: key,
          version: "1.0.0",
          providerStory: providers[key],
          document: demoContract(key),
          origin: "demo",
        },
        r.user.id,
      ),
    );
  });
  app.post(
    "/api/workspace/specmesh/:id/contracts/:key/:version/approve",
    async (r) => {
      const { service } = context(r, true);
      if (r.body?.confirmed !== true)
        fail("Inspect and explicitly confirm this contract.");
      return view(
        await service.approve(
          r.params.key,
          r.params.version,
          r.body.hash,
          r.body.rationale || "",
          r.user.id,
        ),
      );
    },
  );
  app.post(
    "/api/workspace/specmesh/:id/contracts/:key/:version/reject",
    async (r) =>
      view(
        context(r, true).service.reject(
          r.params.key,
          r.params.version,
          r.user.id,
        ),
      ),
  );
  app.get("/api/workspace/specmesh/:id/manifest/:key", async (r) =>
    manifest(context(r).state, r.params.key),
  );
  app.post("/api/workspace/specmesh/:id/verify", async (r) =>
    context(r).service.verify(),
  );
  app.get("/api/workspace/specmesh/:id/registry", async (r) => {
    const { service, state } = context(r);
    for (const c of state.contracts.filter((c) => c.status === "APPROVED"))
      if (!service.store.verifySnapshot(c))
        fail("Published snapshot failed integrity verification.", 409);
    return { format: "specmesh-registry", version: 1, state };
  });
}
