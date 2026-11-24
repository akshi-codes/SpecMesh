import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { spawnSync } from "node:child_process";
import {
  SpecMesh,
  manifest,
  impact,
  compareContracts,
  applyAnalysis,
  cycles,
} from "../packages/specmesh/src/core.ts";
import { sourceHash, hash } from "../packages/specmesh/src/model.ts";
import {
  normalizeMarkdown,
  readDocuments,
} from "../packages/specmesh/src/importer.ts";
import {
  demoFiles,
  demoProposal,
  demoContract,
} from "../packages/specmesh/src/demo.ts";
import { startMock } from "../packages/specmesh/src/mock.ts";
import { validateDocument } from "../packages/specmesh/src/contracts.ts";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specmesh-test-"));
  const service = new SpecMesh(root);
  service.store.init("Fixture", "", "", true);
  const s = service.import(demoFiles, "tester");
  service.analyze(demoProposal(s), "demo", sourceHash(s), "tester");
  return {
    root,
    service,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
function reviewed(service: SpecMesh) {
  for (const d of service.read().analysis!.dependencies)
    service.reviewDependency(d.id, true, "human-fixture-reviewer");
  for (const q of service.read().analysis!.decisions)
    service.decide(
      q.id,
      "RESOLVED",
      "Synthetic test fixture decision; not an actual banking design approval.",
      "human-fixture-reviewer",
    );
}
async function bank(service: SpecMesh) {
  await service.draft(
    {
      id: "BankAccountAPI",
      version: "1.0.0",
      providerStory: "US-2",
      document: demoContract("BankAccountAPI"),
    },
    "proposer",
  );
  const c = service.read().contracts[0];
  await service.approve(
    c.id,
    c.version,
    c.hash,
    "Reviewed synthetic definition",
    "human-fixture-reviewer",
  );
  return service.read().contracts[0];
}

test("imports five stories with exact source lines; duplicate IDs and traversal do not corrupt state", () => {
  const f = fixture();
  try {
    const s = f.service.read();
    assert.equal(s.stories.length, 5);
    assert.equal(s.stories[0].line, 1);
    assert.equal(s.stories[0].acceptance.length, 2);
    assert.throws(
      () =>
        f.service.import(
          [{ path: "duplicate.md", content: "# US-1 — Duplicate" }],
          "tester",
        ),
      /Duplicate/,
    );
    assert.throws(() =>
      f.service.import([{ path: "../auth.json", content: "{}" }], "tester"),
    );
    assert.equal(f.service.read().revision, s.revision);
    assert.throws(() => readDocuments(f.root, "../escape"));
  } finally {
    f.cleanup();
  }
});
test("Spec Kit IDs are qualified by source and criteria are not invented", () => {
  const a = normalizeMarkdown(
    "feature-a/spec.md",
    "### User Story 1 - Sign in\nUser description.",
  );
  const b = normalizeMarkdown(
    "feature-b/spec.md",
    "### User Story 1 - Search\nOther story.",
  );
  assert.notEqual(a[0].id, b[0].id);
  assert.deepEqual(a[0].acceptance, []);
  assert.deepEqual(
    normalizeMarkdown("architecture.md", "# Architecture\nUse services."),
    [],
  );
});
test("analysis validates evidence and references, resets uploaded approvals and detects cycles", () => {
  const f = fixture();
  try {
    const s = f.service.read(),
      p = demoProposal(s);
    p.dependencies[0].evidence[0].quote = "Invented requirement";
    assert.throws(() => applyAnalysis(s, p, "codex"), /Evidence/);
    const trusted = demoProposal(s);
    trusted.dependencies[0].review = "CONFIRMED";
    const next = applyAnalysis(s, trusted, "codex");
    assert.equal(next.analysis!.dependencies[0].review, "REVIEW_REQUIRED");
    assert.equal(next.analysis!.decisions[0].status, "OPEN");
    const dep = structuredClone(next.analysis!.dependencies[0]);
    dep.id = "DEP-cycle";
    dep.provider = "US-2";
    dep.consumer = "US-1";
    dep.interfaceId = "";
    dep.type = "BUSINESS";
    next.analysis!.dependencies.push(dep);
    assert.ok(cycles(next).length);
  } finally {
    f.cleanup();
  }
});
test("same interface has one provider and shared consumer references", async () => {
  const f = fixture();
  try {
    const s = f.service.read();
    assert.equal(
      s.analysis!.dependencies.filter((d) => d.interfaceId === "IdentityAPI")
        .length,
      2,
    );
    await f.service.draft(
      {
        id: "IdentityAPI",
        version: "1.0.0",
        providerStory: "US-1",
        document: demoContract("IdentityAPI"),
      },
      "test",
    );
    await assert.rejects(
      () =>
        f.service.draft(
          {
            id: "IdentityAPI",
            version: "1.1.0",
            providerStory: "US-2",
            document: demoContract("IdentityAPI", "1.1.0"),
          },
          "test",
        ),
      /different provider/,
    );
  } finally {
    f.cleanup();
  }
});
test("OpenAPI validation rejects invalid definitions and external references", async () => {
  assert.ok(
    (
      await validateDocument({
        openapi: "3.1.0",
        info: { title: "Broken", version: "1.0.0" },
        paths: { "/x": { get: {} } },
      })
    ).errors.length,
  );
  await assert.rejects(
    () =>
      validateDocument({
        openapi: "3.1.0",
        info: { title: "Bad", version: "1.0.0" },
        paths: {},
        components: { schemas: { Leak: { $ref: "file:///secret" } } },
      }),
    /External/,
  );
  await assert.rejects(() =>
    validateDocument("openapi: 3.1.0\na: &value x\nb: *value"),
  );
});
test("human approval checks exact draft hash, decisions, freshness and immutable versions", async () => {
  const f = fixture();
  try {
    await f.service.draft(
      {
        id: "BankAccountAPI",
        version: "1.0.0",
        providerStory: "US-2",
        document: demoContract("BankAccountAPI"),
      },
      "proposer",
    );
    let c = f.service.read().contracts[0];
    assert.equal(c.status, "VALIDATED");
    await assert.rejects(
      () => f.service.approve(c.id, c.version, c.hash, "Reviewed", "reviewer"),
      /dependencies/,
    );
    for (const d of f.service.read().analysis!.dependencies)
      f.service.reviewDependency(d.id, true, "reviewer");
    await assert.rejects(
      () => f.service.approve(c.id, c.version, c.hash, "Reviewed", "reviewer"),
      /critical/,
    );
    reviewed(f.service);
    await assert.rejects(
      () => f.service.approve(c.id, c.version, "wrong", "Reviewed", "reviewer"),
      /exact/,
    );
    await f.service.approve(c.id, c.version, c.hash, "Reviewed", "reviewer");
    c = f.service.read().contracts[0];
    assert.ok(f.service.store.verifySnapshot(c));
    await assert.rejects(
      () =>
        f.service.draft(
          {
            id: c.id,
            version: c.version,
            providerStory: c.providerStory,
            document: c.document,
          },
          "test",
        ),
      /already exists/,
    );
    assert.throws(() => f.service.reject(c.id, c.version, "test"), /immutable/);
  } finally {
    f.cleanup();
  }
});
test("source changes invalidate readiness and prevent publishing a stale draft", async () => {
  const f = fixture();
  try {
    reviewed(f.service);
    await bank(f.service);
    const file = {
      ...demoFiles[0],
      content: demoFiles[0].content + "\nNew constraint.",
    };
    f.service.import([file], "tester");
    assert.ok(
      manifest(f.service.read(), "US-2").blockers.some((b) =>
        b.includes("current sources"),
      ),
    );
    assert.equal((await f.service.verify()).ok, false);
    assert.throws(() =>
      f.service.analyze(
        demoProposal(f.service.read()),
        "demo",
        "old",
        "tester",
      ),
    );
  } finally {
    f.cleanup();
  }
});
test("mocks validate examples and requests, simulate auth/status codes and never establish integration readiness", async () => {
  const f = fixture();
  let mock: Awaited<ReturnType<typeof startMock>> | undefined;
  try {
    reviewed(f.service);
    const c = await bank(f.service);
    mock = await startMock(c);
    const unauth = await fetch(mock.url + "/accounts/account-1");
    assert.equal(unauth.status, 401);
    const response = await fetch(mock.url + "/accounts/account-1", {
      headers: { authorization: "Bearer synthetic" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-specmesh-mock"), "simulated");
    assert.deepEqual(await response.json(), {
      accountId: "account-1",
      verified: true,
    });
    assert.equal(
      (
        await fetch(mock.url + "/accounts/missing", {
          headers: {
            authorization: "Bearer synthetic",
            "x-specmesh-status": "404",
          },
        })
      ).status,
      404,
    );
    const readiness = manifest(f.service.read(), "US-3", [
      c.id + "@" + c.version,
    ]);
    assert.equal(readiness.integrationReady, false);
    assert.equal(readiness.implementationVerified, false);
    const broken = structuredClone(c);
    (broken.document as any).paths["/accounts/{accountId}"].get.responses[
      "200"
    ].content["application/json"].example.accountId = 2;
    broken.hash = hash(broken.document);
    await assert.rejects(() => startMock(broken), /example violates/);
  } finally {
    await mock?.close();
    f.cleanup();
  }
});
test("compatibility finds removed operations, incompatible types and required fields; unknown changes require review", () => {
  const before = demoContract("BankAccountAPI") as any,
    after = structuredClone(before);
  after.paths["/accounts/{accountId}"].get.responses["200"].content[
    "application/json"
  ].schema.properties.accountId.type = "integer";
  assert.equal(compareContracts(before, after).status, "BREAKING");
  assert.equal(
    compareContracts(before, { ...before, paths: {} }).status,
    "BREAKING",
  );
  const semantics = structuredClone(before);
  semantics.security = [];
  assert.equal(compareContracts(before, semantics).status, "MANUAL_REVIEW");
  const response = structuredClone(before);
  response.paths["/accounts/{accountId}"].get.responses["200"].content[
    "application/json"
  ].schema.required = ["accountId"];
  assert.equal(compareContracts(before, response).status, "BREAKING");
});
test("impact uses direct and transitive graph consumers and includes assignments", () => {
  const f = fixture();
  try {
    f.service.assign("US-3", "Developer C", "Transfers", "lead");
    const result = impact(f.service.read(), "BankAccountAPI");
    assert.deepEqual(result.direct, ["US-3"]);
    assert.ok(result.transitive.includes("US-4"));
    assert.ok(result.transitive.includes("US-5"));
    assert.equal(
      result.stories.find((s) => s.id === "US-3")?.assignee,
      "Developer C",
    );
  } finally {
    f.cleanup();
  }
});
test("published snapshots are verified; concurrent writers and independent projects stay isolated", async () => {
  const a = fixture(),
    b = fixture();
  try {
    reviewed(a.service);
    const c = await bank(a.service);
    assert.equal(b.service.read().contracts.length, 0);
    const old = a.service.read();
    a.service.assign("US-1", "A", "Identity", "lead");
    assert.throws(
      () => a.service.store.save(old, old.revision, "stale", "write"),
      /changed/,
    );
    fs.writeFileSync(
      path.join(
        a.service.store.root,
        "contracts/approved/BankAccountAPI/1.0.0.json",
      ),
      "{}",
    );
    assert.equal(a.service.store.verifySnapshot(c), false);
    assert.ok(
      (await a.service.verify()).errors.some((e) =>
        e.includes("Snapshot mismatch"),
      ),
    );
  } finally {
    a.cleanup();
    b.cleanup();
  }
});
test("team routes enforce isolation and lead-only review with no shared AI endpoint", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specmesh-api-"));
  const { appConfig } = await import("../server/config.js");
  const { getDb, closeDbForTests } = await import("../server/db.js");
  const { registerSpecMeshApi } = await import("../server/specmesh.js");
  const prior = appConfig.dbPath;
  closeDbForTests();
  appConfig.dbPath = path.join(root, "test.sqlite");
  const db = getDb();
  for (const name of ["lead", "member", "outsider"])
    db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?)").run(
      name,
      name,
      name,
      "fixture",
      0,
      "now",
    );
  db.prepare("INSERT INTO teams VALUES (?,?,?)").run("team", "Team", "now");
  db.prepare("INSERT INTO memberships VALUES (?,?,?)").run(
    "team",
    "lead",
    "lead",
  );
  db.prepare("INSERT INTO memberships VALUES (?,?,?)").run(
    "team",
    "member",
    "member",
  );
  const app = Fastify();
  app.decorateRequest("user", null);
  app.addHook("onRequest", async (r) => {
    (r as any).user = { id: r.headers["x-test-user"] || "lead" };
  });
  registerSpecMeshApi(app);
  const send = (method: any, url: string, payload?: any, user = "lead") =>
    app.inject({ method, url, payload, headers: { "x-test-user": user } });
  try {
    const created = await send("POST", "/api/workspace/specmesh", {
      name: "Team specs",
      teamId: "team",
      demo: true,
    });
    assert.equal(created.statusCode, 200, created.body);
    const key = created.json().key;
    assert.equal(
      (await send("GET", `/api/workspace/specmesh/${key}`, undefined, "member"))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await send(
          "GET",
          `/api/workspace/specmesh/${key}`,
          undefined,
          "outsider",
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await send(
          "PUT",
          `/api/workspace/specmesh/${key}/dependencies/DEP-1`,
          { confirmed: true },
          "member",
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (await send("POST", `/api/workspace/specmesh/${key}/analyze`, {}, "lead"))
        .statusCode,
      404,
    );
    const state = (await send("GET", `/api/workspace/specmesh/${key}`)).json();
    for (const [method, suffix, payload] of [
      ["POST", "/import", { files: [{ path: 4, content: "bad path" }] }],
      ["POST", "/proposals", { provider: "manual", sourceHash: state.sourceHash, proposal: { dependencies: "invalid" } }],
      ["PUT", "/stories/US-1", { assignee: { invalid: true } }],
    ] as const) {
      const invalid = await send(method, `/api/workspace/specmesh/${key}${suffix}`, payload);
      assert.equal(invalid.statusCode, 400, invalid.body);
    }
    assert.equal((await send("GET", `/api/workspace/specmesh/${key}`)).json().revision, state.revision);
    assert.equal(
      (
        await send("POST", `/api/workspace/specmesh/${key}/proposals`, {
          sourceHash: "stale",
          provider: "codex",
          proposal: demoProposal(state),
        })
      ).statusCode,
      409,
    );
  } finally {
    await app.close();
    closeDbForTests();
    appConfig.dbPath = prior;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI workflow is repeatable, exports a registry and requires explicit permission before AI", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specmesh-cli-"));
  const invoke = (...args: string[]) =>
    spawnSync(process.execPath, ["scripts/specmesh.ts", ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
    });
  try {
    const source = path.join(root, "source"),
      dest = path.join(root, "destination"),
      output = path.join(root, "registry.json");
    const first = invoke("demo", "--root", source);
    assert.equal(first.status, 0, first.stderr);
    const before = fs.readFileSync(
      path.join(source, ".specmesh/state/project.json"),
      "utf8",
    );
    assert.equal(invoke("demo", "--root", source).status, 0);
    assert.equal(
      fs.readFileSync(
        path.join(source, ".specmesh/state/project.json"),
        "utf8",
      ),
      before,
    );
    const refused = invoke("analyze", "--root", source, "--provider", "codex");
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /allow-ai/);
    assert.equal(invoke("verify", "--root", source).status, 1);
    assert.equal(
      invoke("registry", "export", "--root", source, "--output", output).status,
      0,
    );
    assert.equal(
      invoke("registry", "import", output, "--root", dest).status,
      0,
    );
    assert.equal(new SpecMesh(dest).read().stories.length, 5);
    assert.equal(
      invoke("registry", "import", output, "--root", dest).status,
      1,
    );
    const manifestPath = path.join(root, "manifest.json");
    assert.equal(
      invoke("workspace", "US-3", "--root", dest, "--output", manifestPath)
        .status,
      0,
    );
    const result = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(result.integrationReady, false);
    assert.ok(result.blockers.length);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("five-story rehearsal prepares US-3 with live mocks and detects a breaking change and downstream impact", async () => {
  const f = fixture(),
    mocks: Awaited<ReturnType<typeof startMock>>[] = [];
  try {
    reviewed(f.service);
    for (const [id, providerStory] of [
      ["IdentityAPI", "US-1"],
      ["BankAccountAPI", "US-2"],
      ["TransferAPI", "US-3"],
    ]) {
      await f.service.draft(
        {
          id,
          providerStory,
          version: "1.0.0",
          document: demoContract(id),
          origin: "demo",
        },
        "test-proposer",
      );
      const c = f.service.read().contracts.find((c) => c.id === id)!;
      await f.service.approve(
        id,
        c.version,
        c.hash,
        "Synthetic demonstration approval",
        "fixture-reviewer",
      );
      if (id !== "TransferAPI")
        mocks.push(
          await startMock(f.service.read().contracts.find((c) => c.id === id)!),
        );
    }
    const readiness = manifest(
      f.service.read(),
      "US-3",
      mocks.map((m) => `${m.contractId}@${m.version}`),
    );
    assert.equal(readiness.contractReady, true);
    assert.equal(readiness.developmentReady, true);
    assert.equal(readiness.integrationReady, false);
    for (const m of mocks) {
      const route =
        m.contractId === "IdentityAPI"
          ? "/users/user-1"
          : "/accounts/account-1";
      assert.equal(
        (
          await fetch(m.url + route, {
            headers: { authorization: "Bearer synthetic" },
          })
        ).status,
        200,
      );
    }
    assert.equal((await f.service.verify()).ok, true);
    const changed = demoContract("BankAccountAPI", "2.0.0") as any;
    changed.paths["/accounts/{accountId}"].get.responses["200"].content[
      "application/json"
    ].schema.properties.accountId.type = "integer";
    changed.paths["/accounts/{accountId}"].get.responses["200"].content[
      "application/json"
    ].example.accountId = 123;
    await f.service.draft(
      {
        id: "BankAccountAPI",
        providerStory: "US-2",
        version: "2.0.0",
        document: changed,
      },
      "proposer",
    );
    assert.equal(
      compareContracts(demoContract("BankAccountAPI"), changed).status,
      "BREAKING",
    );
    assert.deepEqual(impact(f.service.read(), "BankAccountAPI").direct, [
      "US-3",
    ]);
    assert.equal((await f.service.verify()).ok, false);
    assert.equal(
      f.service
        .read()
        .contracts.find(
          (c) => c.id === "BankAccountAPI" && c.version === "1.0.0",
        )?.status,
      "APPROVED",
    );
  } finally {
    await Promise.all(mocks.map((m) => m.close()));
    f.cleanup();
  }
});

test('new proposals cannot erase confirmed dependencies or critical decisions',()=>{
  const f=fixture();try{
    reviewed(f.service);const state=f.service.read(),proposal=demoProposal(state);
    assert.throws(()=>applyAnalysis(state,{...proposal,dependencies:proposal.dependencies.slice(1)},'codex'),/Retain confirmed dependency/);
    assert.throws(()=>applyAnalysis(state,{...proposal,decisions:[]},'codex'),/Retain critical decision/);
    const moved=structuredClone(proposal);moved.dependencies[0].consumer='US-4';assert.throws(()=>applyAnalysis(state,moved,'codex'),/Reject confirmed dependency/);
    const rewritten=structuredClone(proposal);rewritten.decisions[0].question='A different question';assert.throws(()=>applyAnalysis(state,rewritten,'codex'),/Retain the scope/);
    const merged=applyAnalysis(state,proposal,'codex');assert.equal(merged.analysis!.decisions[0].status,'RESOLVED');assert.equal(merged.analysis!.dependencies[0].review,'REVIEW_REQUIRED');
    const changed=structuredClone(state);changed.sources[0].content+='\nChanged';changed.sources[0].hash=hash(changed.sources[0].content);
    assert.equal(applyAnalysis(changed,proposal,'codex').analysis!.decisions[0].status,'OPEN');
  }finally{f.cleanup();}
});
