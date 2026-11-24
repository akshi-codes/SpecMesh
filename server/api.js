import fs from "node:fs";
import path from "node:path";
import { appConfig } from "./config.js";
import { allRows, getDb, oneRow } from "./db.js";
import { discover, getIngestStatus, runHistoricalIngest } from "./importer.js";
import { ingestOtlpLogs } from "./otlp.js";
import {
  overview,
  summary,
  projectRows,
  threadRows,
  selectedRows,
  totals,
  budgetResponse,
  evaluateAlerts,
} from "./analytics.js";
import {
  annotation,
  codexHome,
  preferences,
  savePreferences,
  retentionCutoff,
} from "./preferences.js";
import { createBackup, restoreBackup } from "./storage.js";
import { dayKey } from "./periods.js";
import { registerWorkspaceApi } from "./workspace.js";
import { registerSpecMeshApi } from "./specmesh.js";

function bad(message) {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
function idle() {
  if (getIngestStatus().status === "running")
    throw Object.assign(new Error("Wait for the current scan to finish."), {
      statusCode: 409,
    });
}
function diagnostics(folder) {
  if (typeof folder !== "string" || !path.isAbsolute(folder))
    bad("Enter an absolute path to your Codex home folder.");
  try {
    if (!fs.statSync(folder).isDirectory()) bad("Choose a folder.");
    const sessions = path.join(folder, "sessions");
    if (!fs.existsSync(sessions))
      return {
        valid: false,
        path: folder,
        files: 0,
        message:
          "No sessions folder found. Run a local Codex task first, or choose a different Codex home.",
      };
    fs.accessSync(sessions, fs.constants.R_OK);
    const found = discover(sessions);
    return {
      valid: true,
      path: folder,
      files: found.files.length,
      protected: found.deniedFiles,
      message: found.files.length
        ? "Ready to import local session metrics."
        : "Folder is readable but no session files were found yet.",
    };
  } catch (error) {
    if (error.statusCode) throw error;
    return {
      valid: false,
      path: folder,
      files: 0,
      message:
        "This folder is missing or cannot be read. Check the path and permissions.",
    };
  }
}
export function validatePreferences(body) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    bad("Invalid settings.");
  const allowed = [
    "live",
    "syncSeconds",
    "thresholds",
    "snoozedUntil",
    "costsEnabled",
    "rates",
    "codexHome",
    "retentionDays",
  ];
  if (Object.keys(body).some((k) => !allowed.includes(k)))
    bad("Unknown setting.");
  for (const k of ["live", "costsEnabled"])
    if (k in body && typeof body[k] !== "boolean") bad(`Invalid ${k}.`);
  if (
    "syncSeconds" in body &&
    (!Number.isInteger(body.syncSeconds) ||
      body.syncSeconds < 10 ||
      body.syncSeconds > 3600)
  )
    bad("Sync interval must be 10–3600 seconds.");
  if (
    "retentionDays" in body &&
    (!Number.isInteger(body.retentionDays) ||
      body.retentionDays < 0 ||
      body.retentionDays > 36500)
  )
    bad("Invalid retention period.");
  if (
    "thresholds" in body &&
    (!Array.isArray(body.thresholds) ||
      body.thresholds.length > 10 ||
      body.thresholds.some((n) => !Number.isInteger(n) || n < 1 || n > 1000))
  )
    bad("Choose up to 10 positive percentage thresholds.");
  if (
    body.snoozedUntil !== undefined &&
    body.snoozedUntil !== null &&
    (!Number.isFinite(Date.parse(body.snoozedUntil)) ||
      typeof body.snoozedUntil !== "string")
  )
    bad("Invalid snooze date.");
  if (
    body.codexHome !== undefined &&
    body.codexHome !== null &&
    (typeof body.codexHome !== "string" || !path.isAbsolute(body.codexHome))
  )
    bad("Invalid Codex folder.");
  if ("rates" in body) {
    if (!Array.isArray(body.rates) || body.rates.length > 100)
      bad("Use at most 100 rate entries.");
    const keys = new Set();
    for (const r of body.rates) {
      if (
        !r ||
        Object.keys(r).sort().join(",") !==
          "cached,effectiveDate,input,model,output" ||
        typeof r.model !== "string" ||
        !r.model.trim() ||
        r.model.length > 120 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(r.effectiveDate) ||
        !Number.isFinite(Date.parse(r.effectiveDate)) ||
        ["input", "cached", "output"].some(
          (k) => !Number.isFinite(r[k]) || r[k] < 0 || r[k] > 1e6,
        )
      )
        bad(
          "Each rate needs a model, valid effective date, and nonnegative USD prices per million tokens.",
        );
      const key = r.model + ":" + r.effectiveDate;
      if (keys.has(key)) bad("Duplicate model and effective date.");
      keys.add(key);
    }
  }
  return body;
}
export function registerApi(app) {
  registerWorkspaceApi(app);
  registerSpecMeshApi(app);
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/"))
      reply.header("cache-control", "no-store");
    return payload;
  });
  app.get("/api/health", async () => ({
    ok: !!oneRow("SELECT 1 AS ok"),
    app: "codex-token-monitor",
  }));
  app.get("/api/overview", async (r) => overview(r.query));
  app.get("/api/usage-summary", async (r) => summary(r.query));
  app.get("/api/projects", async (r) => projectRows(r.query));
  app.get("/api/projects/:id/usage", async (r) => ({
    project: oneRow("SELECT * FROM projects WHERE id=?", [r.params.id]),
    ...overview({ ...r.query, projectId: r.params.id }),
    threads: threadRows({ ...r.query, projectId: r.params.id }),
  }));
  app.get("/api/threads", async (r) => threadRows(r.query));
  app.get("/api/threads/:id", async (r, reply) => {
    const thread = oneRow(
      "SELECT th.*,p.name AS project_name FROM threads th JOIN projects p ON p.id=th.project_id WHERE th.id=?",
      [r.params.id],
    );
    if (!thread) return reply.code(404).send({ error: "Thread not found." });
    const { rows, window } = selectedRows(r.query),
      turns = rows.filter((t) => t.thread_id === r.params.id);
    return {
      thread,
      turns,
      totals: totals(turns),
      annotation: annotation("thread", thread.id),
      window,
    };
  });
  app.get("/api/ingest/status", async () => ({
    current: getIngestStatus(),
    last: oneRow("SELECT * FROM ingest_runs ORDER BY id DESC LIMIT 1"),
    recent: allRows("SELECT * FROM ingest_runs ORDER BY id DESC LIMIT 5"),
    tracked: oneRow("SELECT count(*) AS files FROM ingested_files"),
  }));
  app.post("/api/ingest/run", async (r) => {
    if (r.body?.force !== undefined && typeof r.body.force !== "boolean")
      bad("force must be true or false.");
    return runHistoricalIngest({ force: r.body?.force === true });
  });
  app.post("/api/otlp/v1/logs", async (r) => ingestOtlpLogs(r.body || {}));
  app.post("/api/import/jsonl", async (r) => ingestOtlpLogs(r.body || {}));
  app.get("/api/budgets", async () => budgetResponse());
  app.put("/api/budgets", async (r) => {
    const b = r.body || {},
      scope = b.scopeType,
      id = scope === "global" ? "all" : b.scopeId,
      limits = b.limits;
    if (
      !["global", "project"].includes(scope) ||
      typeof id !== "string" ||
      !limits ||
      typeof limits !== "object" ||
      Array.isArray(limits) ||
      !Object.keys(limits).length
    )
      bad("Invalid budget scope or limits.");
    if (
      scope === "project" &&
      !oneRow("SELECT id FROM projects WHERE id=?", [id])
    )
      bad("Project not found.");
    const normalized = Object.entries(limits).map(([p, v]) => {
      const n = v === "" || v == null ? 0 : Number(v);
      if (
        !["weekly", "monthly"].includes(p) ||
        typeof v === "boolean" ||
        !Number.isSafeInteger(n) ||
        n < 0
      )
        bad("Invalid budget period or limit.");
      return [p, n];
    });
    const db = getDb();
    db.exec("BEGIN");
    try {
      for (const [p, n] of normalized) {
        db.prepare(
          "DELETE FROM budgets WHERE scope_type=? AND scope_id=? AND period=?",
        ).run(scope, id, p);
        if (n)
          db.prepare("INSERT INTO budgets VALUES (?,?,?,?,?)").run(
            scope,
            id,
            p,
            n,
            new Date().toISOString(),
          );
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return budgetResponse();
  });
  app.get("/api/annotations", async () =>
    allRows("SELECT * FROM annotations").map((r) => ({
      ...r,
      tags: JSON.parse(r.tags),
      bookmarked: !!r.bookmarked,
    })),
  );
  app.put("/api/annotations/:kind/:id", async (r) => {
    const { kind, id } = r.params,
      b = r.body || {};
    if (
      !["thread", "project"].includes(kind) ||
      !oneRow(
        `SELECT id FROM ${kind === "thread" ? "threads" : "projects"} WHERE id=?`,
        [id],
      )
    )
      bad("Record not found.");
    if (
      Object.keys(b).some(
        (k) => !["label", "tags", "bookmarked", "group_name"].includes(k),
      )
    )
      bad("Unknown annotation field.");
    const value = { ...annotation(kind, id), ...b };
    if (
      typeof value.label !== "string" ||
      value.label.length > 120 ||
      typeof value.group_name !== "string" ||
      value.group_name.length > 80 ||
      typeof value.bookmarked !== "boolean" ||
      !Array.isArray(value.tags) ||
      value.tags.length > 12 ||
      value.tags.some((t) => typeof t !== "string" || t.length > 40)
    )
      bad("Invalid label, group, bookmark, or tags.");
    getDb()
      .prepare(
        "INSERT INTO annotations VALUES (?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET label=excluded.label,tags=excluded.tags,bookmarked=excluded.bookmarked,group_name=excluded.group_name",
      )
      .run(
        kind,
        id,
        value.label.trim(),
        JSON.stringify([
          ...new Set(value.tags.map((t) => t.trim()).filter(Boolean)),
        ]),
        Number(value.bookmarked),
        value.group_name.trim(),
      );
    return annotation(kind, id);
  });
  app.get("/api/settings", async () => ({
    ...preferences(),
    codexHome: codexHome(),
    dbPath: appConfig.dbPath,
    dbExists: true,
    privacyMode: "metrics_only",
    autoIngest: appConfig.autoIngest,
    autoIngestIntervalHours: appConfig.autoIngestIntervalMs / 3600000,
    otelSnippet: `[otel]\nexporter = { otlp-http = { endpoint = "http://127.0.0.1:${appConfig.port}/api/otlp/v1/logs", protocol = "json" } }\nlog_user_prompt = false`,
  }));
  app.put("/api/settings", async (r) => {
    const values = validatePreferences(r.body);
    if ("codexHome" in values) idle();
    if ("retentionDays" in values) bad("Use the confirmed retention action.");
    if (values.codexHome && !diagnostics(values.codexHome).valid)
      bad("Validate a readable Codex folder before saving.");
    return savePreferences(values);
  });
  app.post("/api/diagnostics", async (r) =>
    diagnostics(r.body?.path || codexHome()),
  );
  app.get("/api/alerts", async () => evaluateAlerts());
  app.put("/api/alerts/:id", async (r) => {
    getDb()
      .prepare("UPDATE alerts SET dismissed=1 WHERE id=?")
      .run(r.params.id);
    return { ok: true };
  });
  app.get("/api/backup", async (_r, reply) => {
    idle();
    reply.header(
      "content-disposition",
      'attachment; filename="token-monitor-backup.json"',
    );
    return createBackup();
  });
  app.post("/api/restore", { bodyLimit: 100 * 1024 * 1024 }, async (r) => {
    idle();
    return restoreBackup(r.body, validatePreferences);
  });
  app.post("/api/retention", async (r) => {
    idle();
    validatePreferences({ retentionDays: r.body?.days });
    if (r.body?.confirm !== true) bad("Confirm retention cleanup.");
    savePreferences({ retentionDays: r.body.days });
    const deleted = getDb()
      .prepare("DELETE FROM turns WHERE occurred_at < ?")
      .run(retentionCutoff()).changes;
    getDb().exec("DELETE FROM ingested_files");
    return { deleted };
  });
  app.get("/api/export.csv", async (r, reply) => {
    const { rows, window } = selectedRows(r.query);
    let output;
    if (r.query.format === "daily") {
      const groups = new Map();
      for (const row of rows) {
        const day = dayKey(row.occurred_at, window.timezone),
          key = day + row.project_id;
        if (!groups.has(key))
          groups.set(key, {
            day,
            project: row.project_name,
            total_tokens: 0,
            usage_events: 0,
          });
        const g = groups.get(key);
        g.total_tokens += row.tokens;
        g.usage_events++;
      }
      output = [...groups.values()];
    } else
      output = rows.map((t) => ({
        project: t.project_name,
        thread_id: t.thread_id,
        label: t.label,
        model: t.model,
        occurred_at: t.occurred_at,
        input_tokens: t.input_tokens,
        cached_input_tokens: t.cached_input_tokens,
        output_tokens: t.output_tokens,
        reasoning_output_tokens: t.reasoning_output_tokens,
        total_tokens: t.tokens,
        tool_calls: t.tool_events,
        observed_failures: t.error_events,
      }));
    const headers = Object.keys(
      output[0] || { project: "", occurred_at: "", total_tokens: "" },
    );
    const escape = (v) => {
      let s = String(v ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="token-monitor${r.query.format === "daily" ? "-daily" : ""}.csv"`,
      );
    return [
      headers.join(","),
      ...output.map((row) => headers.map((k) => escape(row[k])).join(",")),
    ].join("\n");
  });
}
