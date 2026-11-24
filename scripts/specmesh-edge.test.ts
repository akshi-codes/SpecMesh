import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SpecMesh, applyAnalysis, compareContracts } from "../packages/specmesh/src/core.ts";
import { hash, sourceHash } from "../packages/specmesh/src/model.ts";
import type { ContractRecord } from "../packages/specmesh/src/model.ts";
import { demoFiles, demoProposal, demoContract } from "../packages/specmesh/src/demo.ts";
import { startMock } from "../packages/specmesh/src/mock.ts";

function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specmesh-edge-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = new SpecMesh(root);
  service.store.init("Edge case fixture", "", "", true);
  const state = service.import(demoFiles, "fixture");
  service.analyze(demoProposal(state), "demo", sourceHash(state), "fixture");
  for (const d of service.read().analysis!.dependencies)
    service.reviewDependency(d.id, true, "fixture-reviewer");
  for (const q of service.read().analysis!.decisions)
    service.decide(q.id, "RESOLVED", "Fixture decision", "fixture-reviewer");
  return { root, service };
}

function contract(document: Record<string, any>): ContractRecord {
  return {
    id: "ExampleAPI", version: "1.0.0", providerStory: "US-1", document,
    hash: hash(document), sourceHash: "fixture", status: "APPROVED", errors: [],
    reviewer: "fixture-reviewer", approvedAt: new Date().toISOString(),
    rationale: "Synthetic mock fixture", origin: "manual",
  };
}

function simpleDocument() {
  return {
    openapi: "3.1.0", info: { title: "Edge fixture", version: "1.0.0" },
    paths: { "/example": { get: { responses: {
      "200": { description: "Success", content: { "application/json": {
        schema: { type: "object", properties: { description: { type: "string" }, example: { type: "string" } } },
        example: { description: "An actual field", example: "Another field" },
      } } },
    } } } },
  };
}

test("expanding a resolved decision's scope requires another human review", (t) => {
  const { service } = fixture(t), state = service.read();
  const proposal = demoProposal(state);
  assert.equal(applyAnalysis(state, proposal, "manual").analysis!.decisions[0].status, "RESOLVED");
  proposal.decisions[0].storyIds.push("US-4");
  const expanded = applyAnalysis(state, proposal, "manual").analysis!.decisions[0];
  assert.equal(expanded.status, "OPEN");
  assert.equal(expanded.reviewer, "");
  assert.equal(expanded.resolution, "");
});

test("schema fields named like annotations retain breaking-change detection", () => {
  const before = simpleDocument(), after: any = structuredClone(before);
  delete after.paths["/example"].get.responses["200"].content["application/json"].schema.properties.description;
  const diff = compareContracts(before, after);
  assert.equal(diff.status, "BREAKING");
  assert.ok(diff.findings.some(f => f.path.endsWith("/properties/description")));
});

test("stale concurrent approval does not publish an immutable snapshot", async (t) => {
  const { service, root } = fixture(t);
  await service.draft({ id: "BankAccountAPI", version: "1.0.0", providerStory: "US-2", document: demoContract("BankAccountAPI") }, "fixture");
  const draft = service.read().contracts[0];
  const approval = service.approve(draft.id, draft.version, draft.hash, "Fixture approval", "fixture-reviewer");
  service.assign("US-2", "Another writer", "Accounts", "fixture");
  await assert.rejects(approval, /Project changed/);
  assert.equal(service.read().contracts[0].status, "VALIDATED");
  assert.equal(fs.existsSync(path.join(root, ".specmesh/contracts/approved/BankAccountAPI/1.0.0.json")), false);
});

test("mock startup rejects changed content carrying an old approved hash", async () => {
  const approved = contract(simpleDocument());
  (approved.document as any).info.title = "Changed after approval";
  let mock: Awaited<ReturnType<typeof startMock>> | undefined;
  try {
    await assert.rejects(async () => { mock = await startMock(approved); }, /hash|content/i);
  } finally { await mock?.close(); }
});

test("mock uses operation parameter overrides and permits optional authentication", async () => {
  const document: any = simpleDocument();
  document.paths = { "/example/{id}": {
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 100 } }],
    get: {
      security: [{}],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
      responses: {
        ...simpleDocument().paths["/example"].get.responses,
        "422": { description: "Invalid", content: { "application/json": { schema: { type: "object" }, example: { error: "invalid" } } } },
      },
    },
  } };
  const mock = await startMock(contract(document));
  try {
    assert.equal((await fetch(mock.url + "/example/5")).status, 200);
    assert.equal((await fetch(mock.url + "/example/0")).status, 422);
  } finally { await mock.close(); }
});

test("mock serves an explicit JSON null example as JSON", async () => {
  const document: any = simpleDocument();
  document.paths["/example"].get.responses["200"].content["application/json"] = { schema: { type: "null" }, example: null };
  const mock = await startMock(contract(document));
  try {
    const response = await fetch(mock.url + "/example");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /application\/json/);
    assert.equal(await response.text(), "null");
  } finally { await mock.close(); }
});

test("malformed imports return a validation error without changing the project", (t) => {
  const { service } = fixture(t), revision = service.read().revision;
  for (const files of [[null], [4], [{}], [{ path: 4, content: "x" }], [{ path: "story.md", content: {} }]])
    assert.throws(() => service.import(files as any, "fixture"), (error: any) => error.statusCode === 400);
  assert.equal(service.read().revision, revision);
});

test("import refuses to strand reviewed stories when IDs disappear", (t) => {
  const { service } = fixture(t), before = service.read();
  assert.throws(() => service.import([{ path: "stories/US-3.md", content: "# US-33 — Renamed transfer\nNew identity." }], "fixture"), /Keep the stable story IDs US-3/);
  assert.deepEqual(service.read(), before);
  const updated = service.import([{ path: "stories/US-3.md", content: demoFiles[2].content + "\nAdditional requirement." }], "fixture");
  assert.equal(updated.stories.length, 5);
});

test("approval rolls back a newly published snapshot when the state commit fails", async (t) => {
  const { service, root } = fixture(t);
  await service.draft({ id: "BankAccountAPI", version: "1.0.0", providerStory: "US-2", document: demoContract("BankAccountAPI") }, "fixture");
  const draft = service.read().contracts[0];
  const rename = fs.renameSync;
  fs.renameSync = ((from, to) => {
    if (to === service.store.file()) throw Object.assign(new Error("Simulated commit failure"), { code: "EIO" });
    rename(from, to);
  }) as typeof fs.renameSync;
  try {
    await assert.rejects(() => service.approve(draft.id, draft.version, draft.hash, "Fixture approval", "fixture-reviewer"), /Simulated commit failure/);
  } finally { fs.renameSync = rename; }
  assert.equal(service.read().contracts[0].status, "VALIDATED");
  assert.equal(fs.existsSync(path.join(root, ".specmesh/contracts/approved/BankAccountAPI/1.0.0.json")), false);
  assert.equal(fs.existsSync(path.join(root, ".specmesh/state/write.lock")), false);
  await service.approve(draft.id, draft.version, draft.hash, "Fixture approval", "fixture-reviewer");
  const approved = service.read().contracts[0];
  assert.equal(service.store.verifySnapshot(approved), true);
  (approved.document as any).info.title = "Changed content";
  assert.equal(service.store.verifySnapshot(approved), false);
});

test("API interface IDs must also be usable as approved contract names", (t) => {
  const { service } = fixture(t), state = service.read(), proposal = demoProposal(state);
  // Use an unreviewed fixture to isolate ID validation from confirmed-edge retention.
  state.analysis = null;
  proposal.dependencies[0].interfaceId = "namespace:IdentityAPI";
  assert.throws(() => applyAnalysis(state, proposal, "manual"), /API interface IDs/);
});
