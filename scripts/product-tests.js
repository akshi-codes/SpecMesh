import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import Fastify from "fastify";
import { appConfig } from "../server/config.js";
import {
  allRows,
  getDb,
  insertTurn,
  upsertProject,
  upsertThread,
} from "../server/db.js";
import { runHistoricalIngest } from "../server/importer.js";
import { registerApi } from "../server/api.js";
import { period } from "../server/periods.js";
import { savePreferences } from "../server/preferences.js";
import { startLiveSync } from "../server/live.js";
import {
  budgetResponse,
  evaluateAlerts,
  costEstimate,
  usageRows,
} from "../server/analytics.js";

export function seed(id, when, input = 100, extra = {}) {
  const db = getDb(),
    projectId = extra.projectId || "fixture-project";
  upsertProject(db, {
    id: projectId,
    name: projectId,
    path: `/fixture/${projectId}`,
    firstSeen: when,
    lastSeen: when,
  });
  upsertThread(db, {
    id: extra.threadId || "fixture-thread",
    projectId,
    title: "Fixture session",
    source: "codex-session",
    model: "fixture-model",
    status: "observed",
    startedAt: when,
    endedAt: when,
    lastSeen: when,
  });
  insertTurn(db, {
    id,
    threadId: extra.threadId || "fixture-thread",
    projectId,
    occurredAt: when,
    source: "codex-session",
    model: "fixture-model",
    inputTokens: input,
    cachedInputTokens: 20,
    outputTokens: 30,
    reasoningOutputTokens: 5,
    toolEvents: 2,
    errorEvents: 0,
    durationMs: null,
    rawUsageHash: id,
    ...extra,
  });
}
export function registerProductTests(test, withTempRoot) {
  const setup = (root) => {
    appConfig.codexHome = path.join(root, "codex");
    appConfig.dbPath = path.join(root, "test.sqlite");
    fs.mkdirSync(path.join(appConfig.codexHome, "sessions"), {
      recursive: true,
    });
  };
  test("usage cache refreshes after local writes, external writes, and rollback", () =>
    withTempRoot("monitor-cache-", async (root) => {
      setup(root);
      const when = new Date(Date.now() - 1000).toISOString();
      seed("cached", when);
      assert.equal(usageRows()[0].input_tokens, 100);
      const db = getDb();
      db.prepare("UPDATE turns SET input_tokens=200 WHERE id='cached'").run();
      assert.equal(usageRows()[0].input_tokens, 200);
      const other = new DatabaseSync(appConfig.dbPath);
      try {
        other
          .prepare("UPDATE turns SET input_tokens=300 WHERE id='cached'")
          .run();
      } finally {
        other.close();
      }
      assert.equal(usageRows()[0].input_tokens, 300);
      db.exec(
        "BEGIN; UPDATE turns SET input_tokens=400 WHERE id='cached'; ROLLBACK;",
      );
      assert.equal(usageRows()[0].input_tokens, 300);
      evaluateAlerts();
      const before = db.prepare("SELECT total_changes() AS n").get().n;
      evaluateAlerts();
      assert.equal(
        db.prepare("SELECT total_changes() AS n").get().n,
        before,
        "Reading unchanged alerts must not write to SQLite",
      );
    }));
  test("live watching imports a newly created session without manual sync", () =>
    withTempRoot("monitor-live-", async (root) => {
      setup(root);
      savePreferences({ live: true, syncSeconds: 3600 });
      const errors = [];
      const stop = startLiveSync({ error: (e) => errors.push(e) });
      try {
        const now = new Date().toISOString();
        const records = [
          {
            timestamp: now,
            type: "session_meta",
            payload: { id: "live-fixture", cwd: "/fixture" },
          },
          {
            timestamp: now,
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                total_token_usage: {
                  input_tokens: 100,
                  output_tokens: 30,
                  total_tokens: 130,
                },
              },
            },
          },
        ];
        fs.writeFileSync(
          path.join(
            appConfig.codexHome,
            "sessions",
            "rollout-live-fixture.jsonl",
          ),
          records.map(JSON.stringify).join("\n"),
        );
        const deadline = Date.now() + 10000;
        while (!allRows("SELECT id FROM turns").length && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(
          allRows(
            "SELECT sum(input_tokens+output_tokens) AS total FROM turns",
          )[0].total,
          130,
        );
        assert.deepEqual(errors, []);
      } finally {
        stop();
      }
    }));
  test("cumulative snapshots, repeated records, rebuilds and privacy", () =>
    withTempRoot("monitor-product-", async (root) => {
      setup(root);
      const now = new Date().toISOString(),
        id = "11111111-1111-1111-1111-111111111111";
      const usage = (n) => ({
        timestamp: now,
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: n,
              output_tokens: 30,
              cached_input_tokens: 20,
              reasoning_output_tokens: 5,
              total_tokens: n + 30,
            },
          },
        },
      });
      const records = [
        {
          timestamp: now,
          type: "session_meta",
          payload: { id, cwd: "/fixture", model: "fixture-model" },
        },
        usage(100),
        usage(250),
        usage(250),
        {
          type: "response_item",
          payload: { type: "message", text: "PRIVATE_CONTENT_SENTINEL" },
        },
      ];
      fs.writeFileSync(
        path.join(appConfig.codexHome, "sessions", `rollout-${id}.jsonl`),
        records.map(JSON.stringify).join("\n"),
      );
      await runHistoricalIngest();
      assert.equal(
        allRows("SELECT sum(input_tokens+output_tokens) AS total FROM turns")[0]
          .total,
        280,
      );
      assert.equal(allRows("SELECT * FROM turns").length, 2);
      await runHistoricalIngest({ force: true });
      assert.equal(allRows("SELECT * FROM turns").length, 2);
      assert.equal(
        JSON.stringify(allRows("SELECT * FROM turns")).includes(
          "PRIVATE_CONTENT_SENTINEL",
        ),
        false,
      );
    }));
  test("every filtered view and export reconciles, with more than 100 threads", () =>
    withTempRoot("monitor-product-", async (root) => {
      setup(root);
      seed("old", new Date(Date.now() - 60 * 86400000).toISOString(), 900);
      seed("new", new Date(Date.now() - 1000).toISOString(), 100);
      for (let i = 0; i < 105; i++)
        seed(`history-${i}`, new Date(Date.now() - 1000).toISOString(), 100, {
          threadId: `thread-${i}`,
        });
      const app = Fastify();
      registerApi(app);
      await app.ready();
      try {
        const get = async (p) => (await app.inject(p)).json();
        const o = await get("/api/overview?range=7d"),
          p = await get("/api/projects?range=7d"),
          t = await get("/api/threads?range=7d"),
          s = await get("/api/usage-summary?range=7d");
        assert.equal(o.totals.total_tokens, 106 * 130);
        assert.equal(p[0].tokens, o.totals.total_tokens);
        assert.equal(
          t.reduce((n, r) => n + r.tokens, 0),
          o.totals.total_tokens,
        );
        assert.equal(t.length, 106);
        assert.equal(s.totals.total_tokens, o.totals.total_tokens);
        assert.equal(s.ratios.cacheRatio, 20);
        const csv = await app.inject("/api/export.csv?range=7d");
        assert.equal(csv.body.split("\n").length, 107);
        const detail = await get("/api/threads/fixture-thread?range=7d");
        assert.equal(detail.totals.total_tokens, 130);
        assert.equal(
          (
            await app.inject(
              "/api/overview?range=custom&from=invalid&to=2026-01-01",
            )
          ).statusCode,
          400,
        );
      } finally {
        await app.close();
      }
    }));
  test("calendar dates and equivalent comparison windows include timezone boundaries", () => {
    const now = Date.parse("2026-09-09T08:00:00Z"),
      p = period({ range: "today", timezone: "Asia/Kolkata" }, now);
    assert.equal(p.start, "2026-09-08T18:30:00.000Z");
    assert.equal(
      Date.parse(p.end) - Date.parse(p.start),
      Date.parse(p.previousEnd) - Date.parse(p.previousStart),
    );
    const dst = period(
      {
        range: "custom",
        from: "2026-03-08",
        to: "2026-03-08",
        timezone: "America/New_York",
      },
      Date.parse("2026-03-10T00:00:00Z"),
    );
    assert.equal(Date.parse(dst.end) - Date.parse(dst.start), 23 * 3600000);
  });
  test("OTLP retries, missing model, and cross-source precedence", () =>
    withTempRoot("monitor-product-", async (root) => {
      setup(root);
      const app = Fastify();
      registerApi(app);
      await app.ready();
      try {
        const record = {
          timeUnixNano: String(BigInt(Date.now() - 1000) * 1000000n),
          attributes: Object.entries({
            "event.name": "codex.sse_event",
            conversation_id: "fixture-thread",
            input_tokens: "100",
            cached_input_tokens: "20",
            output_tokens: "30",
            reasoning_output_tokens: "5",
          }).map(([key, value]) => ({ key, value: { stringValue: value } })),
        };
        const send = async () =>
          (
            await app.inject({
              method: "POST",
              url: "/api/otlp/v1/logs",
              payload: { logRecords: [record] },
            })
          ).json();
        assert.equal((await send()).imported, 1);
        assert.equal((await send()).skipped, 1);
        seed("historical", new Date(Date.now() - 1000).toISOString());
        assert.equal(
          (await app.inject("/api/overview")).json().totals.total_tokens,
          130,
        );
      } finally {
        await app.close();
      }
    }));
  test("budget thresholds deduplicate, snooze, rearm, and age out", () =>
    withTempRoot("monitor-product-", async (root) => {
      setup(root);
      const now = Date.now();
      seed("expiry", new Date(now - 6.5 * 86400000).toISOString());
      getDb()
        .prepare("INSERT INTO budgets VALUES (?,?,?,?,?)")
        .run("global", "all", "weekly", 100, new Date(now).toISOString());
      assert.equal(evaluateAlerts(now).length, 2);
      assert.equal(evaluateAlerts(now).length, 2);
      const b = budgetResponse(now).global.weekly;
      assert.equal(b.expiring, 130);
      assert.ok(b.projected < b.used);
      evaluateAlerts(now + 8 * 86400000);
      assert.equal(
        allRows("SELECT * FROM alert_state WHERE exceeded=1").length,
        0,
      );
      savePreferences({ snoozedUntil: new Date(now + 3600000).toISOString() });
      assert.equal(evaluateAlerts(now).length, 2);
      savePreferences({ snoozedUntil: null });
      assert.equal(evaluateAlerts(now + 1).length, 4);
    }));
  test("labels, groups, costs, backup restore rollback and retention", () =>
    withTempRoot("monitor-product-", async (root) => {
      setup(root);
      seed("new", new Date(Date.now() - 1000).toISOString());
      seed("old", new Date(Date.now() - 40 * 86400000).toISOString());
      const app = Fastify();
      registerApi(app);
      await app.ready();
      const send = (method, url, payload) =>
        app.inject({ method, url, payload });
      try {
        assert.equal(
          (
            await send("PUT", "/api/annotations/thread/fixture-thread", {
              label: "Debug session",
              tags: ["debugging"],
              bookmarked: true,
            })
          ).statusCode,
          200,
        );
        assert.equal(
          (
            await send("PUT", "/api/annotations/project/fixture-project", {
              label: "Alias",
              group_name: "Work",
            })
          ).statusCode,
          200,
        );
        assert.equal(
          (await app.inject("/api/projects?group=Work")).json()[0].name,
          "Alias",
        );
        savePreferences({
          costsEnabled: true,
          rates: [
            {
              model: "fixture-model",
              effectiveDate: "2020-01-01",
              input: 2,
              cached: 1,
              output: 10,
            },
          ],
        });
        const cost = costEstimate([
          {
            model: "fixture-model",
            occurred_at: new Date().toISOString(),
            input_tokens: 100,
            cached_input_tokens: 20,
            output_tokens: 30,
          },
        ]);
        assert.equal(cost.usd, 480 / 1e6);
        assert.equal(cost.covered, 1);
        const backup = (await app.inject("/api/backup")).json();
        assert.equal(backup.tables.turns.length, 2);
        const corrupt = structuredClone(backup);
        corrupt.tables.turns[0].thread_id = "missing";
        assert.equal(
          (await send("POST", "/api/restore", corrupt)).statusCode,
          400,
        );
        assert.equal(allRows("SELECT * FROM turns").length, 2);
        const leaking = structuredClone(backup);
        leaking.tables.turns[0].prompt = "private";
        assert.equal(
          (await send("POST", "/api/restore", leaking)).statusCode,
          400,
        );
        assert.equal(
          (
            await send("POST", "/api/retention", { days: 7, confirm: true })
          ).json().deleted,
          1,
        );
        assert.equal(
          (await send("POST", "/api/restore", backup)).statusCode,
          200,
        );
        assert.equal(allRows("SELECT * FROM turns").length, 2);
        assert.equal(
          allRows("SELECT label FROM annotations WHERE kind='thread'")[0].label,
          "Debug session",
        );
        assert.equal(
          (await send("PUT", "/api/settings", { rates: [{ model: "broken" }] }))
            .statusCode,
          400,
        );
        assert.equal(
          (
            await send("POST", "/api/diagnostics", {
              path: appConfig.codexHome,
            })
          ).json().valid,
          true,
        );
      } finally {
        await app.close();
      }
    }));
}
