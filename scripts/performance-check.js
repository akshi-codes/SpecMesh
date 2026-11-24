// Synthetic, isolated benchmark. Optional argument selects a server source directory.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const source = path.resolve(process.argv[2] || "server");
const load = (name) => import(pathToFileURL(path.join(source, name)));
const { appConfig } = await load("config.js");
const { closeDbForTests } = await load("db.js");
const { runHistoricalIngest } = await load("importer.js");
const analytics = await load("analytics.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "monitor-performance-"));
appConfig.dbPath = path.join(root, "test.sqlite");
appConfig.codexHome = path.join(root, "codex");
const sessions = path.join(appConfig.codexHome, "sessions");
fs.mkdirSync(sessions, { recursive: true });
try {
  for (let file = 0; file < 5; file++) {
    const records = [
      {
        type: "session_meta",
        payload: { id: `perf-${file}`, cwd: `/perf/${file}`, model: "fixture" },
      },
    ];
    for (let i = 1; i <= 1500; i++)
      records.push({
        timestamp: new Date(Date.now() - (1501 - i) * 60000).toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: i * 100,
              output_tokens: i * 20,
              total_tokens: i * 120,
            },
          },
        },
      });
    fs.writeFileSync(
      path.join(sessions, `rollout-${file}.jsonl`),
      records.map(JSON.stringify).join("\n"),
    );
  }
  const timings = {};
  for (const [name, operation] of [
    ["initialImport", () => runHistoricalIngest()],
    ["unchangedImport", () => runHistoricalIngest()],
    ["forcedRebuild", () => runHistoricalIngest({ force: true })],
    [
      "reports",
      () => {
        const query = { range: "30d", timezone: "Asia/Kolkata" };
        analytics.overview(query);
        analytics.summary(query);
        analytics.projectRows(query);
        analytics.threadRows(query);
        analytics.budgetResponse();
        analytics.evaluateAlerts();
      },
    ],
  ]) {
    const start = performance.now();
    await operation();
    timings[name] = Math.round(performance.now() - start);
  }
  const total = analytics.overview({ range: "all" }).totals.total_tokens;
  if (total !== 900000) throw new Error(`Unexpected benchmark total: ${total}`);
  console.log(JSON.stringify({ events: 7500, milliseconds: timings, total }));
} finally {
  closeDbForTests();
  if (
    path.dirname(root) === os.tmpdir() &&
    path.basename(root).startsWith("monitor-performance-")
  )
    fs.rmSync(root, { recursive: true, force: true });
}
