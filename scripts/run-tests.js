import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { appConfig } from "../server/config.js";
import {
  allRows,
  closeDbForTests,
  getDb,
  insertTurn,
  upsertProject,
  upsertThread,
} from "../server/db.js";
import { runHistoricalIngest } from "../server/importer.js";
import { registerApi } from "../server/api.js";
import { registerProductTests } from "./product-tests.js";
import { registerWorkspaceTests } from "./workspace-tests.js";

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function withTempRoot(prefix, fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve(fn(tempRoot)).finally(() => {
    closeDbForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
}

test("historical importer stores metrics but not prompt/output content", async () =>
  withTempRoot("token-monitor-", async (tempRoot) => {
    appConfig.codexHome = path.join(tempRoot, ".codex");
    appConfig.dbPath = path.join(tempRoot, "monitor.sqlite");
    fs.mkdirSync(
      path.join(appConfig.codexHome, "sessions", "2026", "07", "02"),
      { recursive: true },
    );
    const secretPrompt = "PLEASE_DO_NOT_STORE_THIS_PROMPT";
    const secretAnswer = "PLEASE_DO_NOT_STORE_THIS_ANSWER";
    const file = path.join(
      appConfig.codexHome,
      "sessions",
      "2026",
      "07",
      "02",
      "rollout-2026-07-02T01-02-03-019d8b00-bee1-7672-96f0-721b8672714d.jsonl",
    );
    fs.writeFileSync(
      file,
      [
        JSON.stringify({
          type: "thread.started",
          thread_id: "019d8b00-bee1-7672-96f0-721b8672714d",
          payload: { cwd: "C:\\Projects\\Token Monitor", model: "gpt-test" },
        }),
        JSON.stringify({
          type: "response_item",
          item: { type: "message", text: secretPrompt },
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 100,
            cached_input_tokens: 20,
            output_tokens: 30,
            reasoning_output_tokens: 5,
          },
          text: secretAnswer,
        }),
      ].join("\n"),
    );

    const result = await runHistoricalIngest();
    assert.equal(result.turnsImported, 1);
    const turns = allRows("SELECT * FROM turns");
    assert.equal(turns.length, 1);
    assert.equal(turns[0].input_tokens, 100);
    assert.equal(turns[0].output_tokens, 30);

    const incremental = await runHistoricalIngest();
    assert.equal(incremental.filesScanned, 0);
    assert.equal(incremental.filesSkipped, 1);
    assert.equal(incremental.turnsImported, 0);

    const forced = await runHistoricalIngest({ force: true });
    assert.equal(forced.filesScanned, 1);
    assert.equal(forced.duplicateTurns, 1);
    assert.equal(forced.turnsImported, 0);
    closeDbForTests();
    const dbBytes = fs.readFileSync(appConfig.dbPath, "utf8");
    assert.equal(dbBytes.includes(secretPrompt), false);
    assert.equal(dbBytes.includes(secretAnswer), false);
  }));

test("historical importer skips denied token-like files", async () =>
  withTempRoot("token-monitor-", async (tempRoot) => {
    appConfig.codexHome = path.join(tempRoot, ".codex");
    appConfig.dbPath = path.join(tempRoot, "monitor.sqlite");
    fs.mkdirSync(path.join(appConfig.codexHome, "sessions"), {
      recursive: true,
    });
    const denied = path.join(
      appConfig.codexHome,
      "sessions",
      "token-dump.jsonl",
    );
    fs.writeFileSync(denied, JSON.stringify({ usage: { input_tokens: 999 } }));
    await runHistoricalIngest();
    getDb();
    assert.equal(allRows("SELECT * FROM turns").length, 0);
  }));

test("budgets persist and filtered exports respond", async () =>
  withTempRoot("token-monitor-api-", async (tempRoot) => {
    appConfig.codexHome = path.join(tempRoot, ".codex");
    appConfig.dbPath = path.join(tempRoot, "monitor.sqlite");
    const app = Fastify();
    registerApi(app);
    await app.ready();

    const saved = await app.inject({
      method: "PUT",
      url: "/api/budgets",
      payload: {
        scopeType: "global",
        scopeId: "all",
        limits: { weekly: 500000, monthly: 2000000 },
      },
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().global.weekly.limit, 500000);
    assert.equal(saved.json().global.monthly.limit, 2000000);
    const rejected = await app.inject({
      method: "PUT",
      url: "/api/budgets",
      payload: {
        scopeType: "global",
        scopeId: "all",
        limits: { weekly: 100, monthly: -1 },
      },
    });
    assert.equal(rejected.statusCode, 400);
    assert.equal(
      (await app.inject({ method: "GET", url: "/api/budgets" })).json().global
        .weekly.limit,
      500000,
    );

    const exportResponse = await app.inject({
      method: "GET",
      url: "/api/export.csv?range=7d&format=daily",
    });
    assert.equal(exportResponse.statusCode, 200);
    assert.match(exportResponse.headers["content-disposition"], /daily\.csv/);
    await app.close();
  }));

registerProductTests(test, withTempRoot);
registerWorkspaceTests(test, withTempRoot);
for (const item of tests) {
  try {
    await item.fn();
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`${tests.length} tests passed`);
