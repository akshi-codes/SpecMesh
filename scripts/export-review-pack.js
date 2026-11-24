// Run on a developer's computer. Creates a local file; never transmits data.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { appConfig } from "../server/config.js";
import { closeDbForTests } from "../server/db.js";
import { runHistoricalIngest } from "../server/importer.js";
import { selectedRows, totals } from "../server/analytics.js";
import { validatePack } from "../server/teams.js";
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!key.startsWith("--") || !process.argv[i + 1])
    throw new Error("Use --name value arguments.");
  args[key.slice(2)] = process.argv[i + 1];
}
if (!args.title || !args.from || !args.to)
  throw new Error(
    'Required: --title "Task name" --from YYYY-MM-DD --to YYYY-MM-DD. Optional: --threads id1,id2 --output file.json --timezone UTC --id stable-task-id',
  );
try {
  const result = await runHistoricalIngest();
  if (["failed", "partial"].includes(result.status))
    throw new Error(
      "Some local data could not be imported. Resolve ingestion errors before exporting.",
    );
  let { rows } = selectedRows({
    range: "custom",
    from: args.from,
    to: args.to,
    timezone: args.timezone || "UTC",
  });
  if (args.threads) {
    const selected = new Set(args.threads.split(",").filter(Boolean));
    rows = rows.filter((r) => selected.has(r.thread_id));
  }
  if (!rows.length)
    throw new Error("No usage events match the selected dates and threads.");
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const value = {
    format: "codex-review",
    version: 1,
    origin: hash(path.resolve(appConfig.dbPath)),
    createdAt: new Date().toISOString(),
    tasks: [
      {
        id: args.id || hash(args.title),
        title: args.title,
        kind: "other",
        status: "working",
        rework: "unrecorded",
        blocker: "",
        lesson: "",
        link: "",
        metrics: totals(rows),
        models: [...new Set(rows.map((r) => r.model || "unknown"))],
        coverage: "partial",
      },
    ],
  };
  const output = path.resolve(args.output || "codex-review-pack.json");
  validatePack(value);
  // Refuse to overwrite a previous contribution without an explicit new filename.
  fs.writeFileSync(output, JSON.stringify(value, null, 2), { flag: "wx" });
  console.log(
    `Created ${output}: ${rows.length} events, ${value.tasks[0].metrics.threads} threads. Review this file before uploading. No data was sent.`,
  );
} finally {
  closeDbForTests();
}
