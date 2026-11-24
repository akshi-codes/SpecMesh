import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { SpecMesh } from "../packages/specmesh/src/core.ts";
import { bundle, readContext, CodexProvider } from "../packages/specmesh/src/ai.ts";
import { demoFiles, demoProposal, demoContract } from "../packages/specmesh/src/demo.ts";
import { sourceHash } from "../packages/specmesh/src/model.ts";

const cli = fileURLToPath(new URL("./specmesh.ts", import.meta.url));
function run(root: string, args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args, "--root", root], {
    encoding: "utf8",
    timeout: 20000,
    // Regression tests must never contact Codex, including failure-path tests.
    env: { ...process.env, SPECMESH_CODEX_PATH: path.join(root, "no-codex-executable") },
    windowsHide: true,
    shell: false,
  });
  if (result.error) throw result.error;
  return { ...result, output: result.stdout + result.stderr };
}
async function fixture(t: test.TestContext, approve = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specmesh-cli-review-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = new SpecMesh(path.join(root, "original"));
  service.store.init("Synthetic exchange fixture", "", "", true);
  const imported = service.import(demoFiles, "fixture");
  service.analyze(demoProposal(imported), "demo", sourceHash(imported), "fixture");
  if (approve) {
    for (const dependency of service.read().analysis!.dependencies)
      service.reviewDependency(dependency.id, true, "fixture-reviewer");
    for (const decision of service.read().analysis!.decisions)
      service.decide(decision.id, "RESOLVED", "Synthetic fixture decision", "fixture-reviewer");
    await service.draft({
      id: "BankAccountAPI", version: "1.0.0", providerStory: "US-2",
      document: demoContract("BankAccountAPI"),
    }, "fixture-author");
    const contract = service.read().contracts[0];
    await service.approve(contract.id, contract.version, contract.hash, "Synthetic fixture review", "fixture-reviewer");
  }
  const contextPath = path.join(root, "context.json");
  fs.writeFileSync(contextPath, JSON.stringify(bundle(service.read())));
  return { root, service, contextPath };
}

test("source bundles preserve provider ownership, approvals and stale fingerprints", async (t) => {
  const { service } = await fixture(t, true);
  service.assign("US-2", "Assigned developer", "Accounts", "fixture");
  const before = service.read();
  const restored = readContext(bundle(before));
  assert.deepEqual(restored.contracts, before.contracts);
  assert.deepEqual(restored.stories, before.stories);
  assert.deepEqual(restored.analysis, before.analysis);
  service.import([{ ...demoFiles[0], content: demoFiles[0].content + "\nUpdated requirement." }], "fixture");
  const changed = service.read();
  const stale = readContext(bundle(changed));
  assert.notEqual(stale.contracts[0].sourceHash, sourceHash(stale));
  assert.equal(stale.contracts[0].sourceHash, before.contracts[0].sourceHash);
  assert.equal(stale.analysis!.sourceHash, before.analysis!.sourceHash);
});

test("exported context with approved contracts completes local analysis and preserves snapshots", async (t) => {
  const { root, service, contextPath } = await fixture(t, true);
  const target = path.join(root, "analysis");
  const output = path.join(root, "proposal.json");
  const result = run(target, ["analyze", "--context", contextPath, "--provider", "demo", "--output", output]);
  assert.equal(result.status, 0, result.output);
  const local = new SpecMesh(target);
  assert.deepEqual(local.read().contracts, service.read().contracts);
  assert.equal(local.store.verifySnapshot(local.read().contracts[0]), true);
  assert.equal(local.read().analysis!.dependencies.every((dependency) => dependency.review === "REVIEW_REQUIRED"), true);
  assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).sourceHash, sourceHash(service.read()));
});

test("AI opt-in, context failures and unavailable Codex leave analysis folders retryable", async (t) => {
  const { root, contextPath } = await fixture(t);
  const target = path.join(root, "analysis");
  const statePath = path.join(target, ".specmesh");
  let result = run(target, ["analyze", "--context", contextPath, "--provider", "codex"]);
  assert.equal(result.status, 1);
  assert.match(result.output, /--allow-ai/);
  assert.equal(fs.existsSync(statePath), false);

  const corrupted = JSON.parse(fs.readFileSync(contextPath, "utf8"));
  corrupted.sourceHash = "stale-or-corrupt";
  const invalidPath = path.join(root, "invalid-context.json");
  fs.writeFileSync(invalidPath, JSON.stringify(corrupted));
  result = run(target, ["analyze", "--context", invalidPath, "--provider", "demo"]);
  assert.equal(result.status, 1);
  assert.match(result.output, /fingerprint mismatch/);
  assert.equal(fs.existsSync(statePath), false);

  result = run(target, ["analyze", "--context", contextPath, "--provider", "codex", "--allow-ai"]);
  assert.equal(result.status, 1);
  assert.match(result.output, /Codex analysis failed/);
  assert.equal(fs.existsSync(statePath), false);

  result = run(target, ["analyze", "--context", contextPath, "--provider", "demo"]);
  assert.equal(result.status, 0, result.output);
});

test("existing output is rejected before context import or an AI request", async (t) => {
  const { root, contextPath } = await fixture(t);
  const target = path.join(root, "analysis");
  const output = path.join(root, "already-reviewed.json");
  fs.writeFileSync(output, "reviewed result");
  const result = run(target, ["analyze", "--context", contextPath, "--provider", "codex", "--allow-ai", "--output", output]);
  assert.equal(result.status, 1);
  assert.match(result.output, /Output already exists/);
  assert.equal(fs.readFileSync(output, "utf8"), "reviewed result");
  assert.equal(fs.existsSync(path.join(target, ".specmesh")), false);
});

test("registry imports reject altered source hashes and derived stories before creating state", async (t) => {
  const { root, service } = await fixture(t);
  for (const tamper of ["source", "story"] as const) {
    const state = service.read();
    if (tamper === "source") state.sources[0].content += "Changed outside import";
    else state.stories[0].title = "Not the imported title";
    const file = path.join(root, `${tamper}.json`);
    fs.writeFileSync(file, JSON.stringify({ format: "specmesh-registry", version: 1, state }));
    const target = path.join(root, tamper);
    const result = run(target, ["registry", "import", file]);
    assert.equal(result.status, 1);
    assert.match(result.output, /hash mismatch|Story records/);
    assert.equal(fs.existsSync(path.join(target, ".specmesh")), false);
  }
});

test("workspace manifests use their documented directory and contract generation validates provider first", async (t) => {
  const { root, service } = await fixture(t);
  const original = path.join(root, "original");
  let result = run(original, ["workspace", "US-3"]);
  assert.equal(result.status, 0, result.output);
  assert.equal(fs.existsSync(path.join(service.store.root, "manifests", "US-3.manifest.json")), true);
  result = run(original, ["contracts", "generate", "--interface", "BankAccountAPI", "--story", "US-999", "--provider", "codex", "--allow-ai"]);
  assert.equal(result.status, 1);
  assert.match(result.output, /known provider story/);
  assert.doesNotMatch(result.output, /Codex analysis failed/);
  result = run(original, ["doctor", "--model", "chosen-model"]);
  assert.equal(result.status, 0, result.output);
  const diagnostic = JSON.parse(result.stdout);
  assert.equal(diagnostic.selectedModel, "chosen-model");
  assert.equal(diagnostic.modelSource, "--model");
  assert.equal(diagnostic.available, false);
});

test("local Codex keeps explicit models and account isolation, with actionable model errors", async (t) => {
  const { service } = await fixture(t);
  let exitCode = 0;
  let diagnosticMessage = 'ERROR: {"error":{"code":"model_not_found","message":"Unsupported model"}}';
  let capturedArgs: string[] = [];
  let capturedEnv: NodeJS.ProcessEnv = {};
  t.mock.method(childProcess, "spawn", (_binary: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    capturedArgs = args;
    capturedEnv = options.env;
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
      exitCode: null as number | null, kill() { return true; },
    });
    queueMicrotask(() => {
      if (exitCode) child.stderr.end(diagnosticMessage);
      else child.stdout.end(JSON.stringify({ dependencies: [], decisions: [] }));
      child.exitCode = exitCode;
      child.emit("close", exitCode);
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const provider = new CodexProvider({ model: "explicit-account-model" });
  await provider.analyzeStories(service.read());
  assert.equal(capturedArgs[capturedArgs.indexOf("--model") + 1], "explicit-account-model");
  assert.equal(capturedArgs.includes("--ignore-user-config"), true);
  assert.equal(capturedArgs[capturedArgs.indexOf("--sandbox") + 1], "read-only");
  assert.equal(capturedEnv.OPENAI_API_KEY, undefined);
  assert.equal(capturedEnv.CODEX_API_KEY, undefined);
  exitCode = 1;
  await assert.rejects(provider.analyzeStories(service.read()), /Set --model or SPECMESH_CODEX_MODEL/);
  diagnosticMessage = 'ERROR: {"error":{"message":"This model requires a newer version of Codex. Please upgrade to the latest app or CLI."}}';
  await assert.rejects(provider.analyzeStories(service.read()), /requires a newer Codex CLI/);
  await assert.rejects(provider.analyzeStories({ ...service.read(), stories: [] }), /at least one recognized story/);
});

test("contract AI prompt receives the requested canonical version and provider", async (t) => {
  const { service } = await fixture(t);
  const provider = new CodexProvider();
  let instruction = "";
  t.mock.method(provider, "run", async (_state, prompt: string) => {
    instruction = prompt;
    return { documentJson: JSON.stringify(demoContract("BankAccountAPI", "2.0.0")) };
  });
  const result = await provider.proposeContracts(service.read(), "BankAccountAPI", { version: "2.0.0", providerStory: "US-2" });
  assert.match(instruction, /info.version to exactly 2\.0\.0/);
  assert.match(instruction, /provider story is US-2/);
  assert.equal((result.document as any).info.version, "2.0.0");
});
