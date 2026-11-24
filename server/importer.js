import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { isDeniedCodexPath } from "./config.js";
import {
  getDb,
  statement,
  insertTurn,
  upsertProject,
  upsertThread,
} from "./db.js";
import { projectFromPath, stableId, toIso } from "./util.js";
import { codexHome, retentionCutoff } from "./preferences.js";

let active = { status: "idle" },
  promise;
export const getIngestStatus = () => active;
export function discover(root) {
  const files = [];
  let deniedFiles = 0;
  if (!fs.existsSync(root)) return { files, deniedFiles };
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (isDeniedCodexPath(full)) {
        deniedFiles++;
        continue;
      }
      if (entry.isDirectory()) stack.push(full);
      if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(full);
    }
  }
  return { files: files.sort(), deniedFiles };
}
export function normalizeUsage(u) {
  const number = (value) => {
    const n = Number(value ?? 0);
    if (!Number.isSafeInteger(n) || n < 0)
      throw new Error("Invalid token count");
    return n;
  };
  const input_tokens = number(u.input_tokens),
    output_tokens = number(u.output_tokens);
  const cached_input_tokens = number(
    u.cached_input_tokens ?? u.input_tokens_details?.cached_tokens,
  );
  const reasoning_output_tokens = number(
    u.reasoning_output_tokens ?? u.output_tokens_details?.reasoning_tokens,
  );
  if (
    cached_input_tokens > input_tokens ||
    reasoning_output_tokens > output_tokens
  )
    throw new Error("Invalid token breakdown");
  const total_tokens = number(u.total_tokens ?? input_tokens + output_tokens);
  if (total_tokens !== input_tokens + output_tokens)
    throw new Error("Token total does not reconcile");
  return {
    input_tokens,
    cached_input_tokens,
    output_tokens,
    reasoning_output_tokens,
    total_tokens,
  };
}
export function runHistoricalIngest(options = {}) {
  if (promise) return promise;
  promise = run(options).finally(() => {
    promise = null;
  });
  return promise;
}
async function run({ force = false } = {}) {
  const db = getDb(),
    started = Date.now(),
    startedAt = new Date(started).toISOString();
  const id = db
    .prepare("INSERT INTO ingest_runs(started_at,status) VALUES (?,?)")
    .run(startedAt, "running").lastInsertRowid;
  active = {
    status: "running",
    startedAt,
    filesScanned: 0,
    filesSkipped: 0,
    filesFailed: 0,
    deniedFiles: 0,
    turnsImported: 0,
    invalidLines: 0,
    duplicateTurns: 0,
  };
  try {
    const found = discover(path.join(codexHome(), "sessions"));
    active.deniedFiles = found.deniedFiles;
    for (const file of found.files) {
      await new Promise((resolve) => setImmediate(resolve));
      try {
        const stat = fs.statSync(file),
          old = statement(
            db,
            "SELECT * FROM ingested_files WHERE file_path=?",
          ).get(file);
        if (
          !force &&
          old?.parser_version === 2 &&
          old.last_status === "completed" &&
          old.file_size === stat.size &&
          old.modified_ms === Math.trunc(stat.mtimeMs)
        ) {
          active.filesSkipped++;
          continue;
        }
        active.filesScanned++;
        // Parse before opening a transaction so other requests cannot join it.
        const result = await parseFile(file, stat);
        db.exec("BEGIN IMMEDIATE");
        try {
          const prior = new Set(
            db
              .prepare("SELECT id FROM turns WHERE source_file=?")
              .all(file)
              .map((r) => r.id),
          );
          db.prepare("DELETE FROM turns WHERE source_file=?").run(file);
          const cleanedThreads = new Set();
          for (const item of result.items) {
            upsertProject(db, item.project);
            upsertThread(db, item.thread);
            if (!cleanedThreads.has(item.thread.id)) {
              statement(
                db,
                "DELETE FROM turns WHERE thread_id=? AND source_file IS NULL AND source != 'codex-otel'",
              ).run(item.thread.id);
              cleanedThreads.add(item.thread.id);
            }
            const written = insertTurn(db, item.turn).changes;
            if (written && !prior.has(item.turn.id)) active.turnsImported++;
            else active.duplicateTurns++;
          }
          db.prepare(
            `INSERT INTO ingested_files(file_path,file_size,modified_ms,last_status,turns_seen,invalid_lines,updated_at,parser_version) VALUES (?,?,?,'completed',?,?,?,2)
            ON CONFLICT(file_path) DO UPDATE SET file_size=excluded.file_size,modified_ms=excluded.modified_ms,last_status=excluded.last_status,turns_seen=excluded.turns_seen,invalid_lines=excluded.invalid_lines,updated_at=excluded.updated_at,parser_version=2`,
          ).run(
            file,
            stat.size,
            Math.trunc(stat.mtimeMs),
            result.items.length,
            result.invalid,
            new Date().toISOString(),
          );
          db.exec("COMMIT");
          active.invalidLines += result.invalid;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      } catch {
        active.filesFailed++;
      }
    }
    active.status = active.filesFailed ? "partial" : "completed";
    active.message = active.filesFailed
      ? "Some files could not be read. Check folder permissions and retry."
      : "Local session scan completed.";
  } catch {
    active.status = "failed";
    active.message =
      "Cannot scan the session folder. Check the path and read permissions in Settings.";
  }
  active.finishedAt = new Date().toISOString();
  active.durationMs = Date.now() - started;
  db.prepare(
    `UPDATE ingest_runs SET finished_at=?,status=?,files_scanned=?,files_skipped=?,files_failed=?,denied_files=?,turns_imported=?,invalid_lines=?,duplicate_turns=?,duration_ms=?,message=? WHERE id=?`,
  ).run(
    active.finishedAt,
    active.status,
    active.filesScanned,
    active.filesSkipped,
    active.filesFailed,
    active.deniedFiles,
    active.turnsImported,
    active.invalidLines,
    active.duplicateTurns,
    active.durationMs,
    active.message,
    id,
  );
  return { ...active };
}
async function parseFile(file, stat) {
  let threadId =
    path
      .basename(file)
      .match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0] ||
    stableId(file);
  let projectPath = "Unknown project",
    model = null,
    startedAt = stat.birthtime.toISOString(),
    lastSeen = stat.mtime.toISOString();
  let cumulative = null,
    index = 0,
    tools = 0,
    errors = 0,
    invalid = 0;
  const items = [],
    seen = new Set(),
    calls = new Set(),
    cutoff = retentionCutoff();
  const stream = readline.createInterface({
    input: fs.createReadStream(file, "utf8"),
    crlfDelay: Infinity,
  });
  let linesRead = 0;
  for await (const line of stream) {
    if (++linesRead % 500 === 0)
      await new Promise((resolve) => setImmediate(resolve));
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      invalid++;
      continue;
    }
    const p = event.payload || event.item || event;
    if (event.type === "session_meta" || event.type === "thread.started") {
      threadId = p.id || p.thread_id || event.thread_id || threadId;
      startedAt = toIso(event.timestamp, new Date(startedAt));
    }
    if (typeof p.cwd === "string") projectPath = p.cwd;
    if (typeof p.model === "string") model = p.model;
    lastSeen = toIso(event.timestamp || event.created_at, new Date(lastSeen));
    const type = p.type || event.type || "";
    if (
      /^(function_call|custom_tool_call|tool_call|command_execution)$/.test(
        type,
      )
    ) {
      const callId = p.call_id || p.id || `call-${calls.size}`;
      if (!calls.has(callId)) {
        tools++;
        calls.add(callId);
      }
    }
    if (
      /tool_result|function_call_output|command_execution/.test(type) &&
      (p.success === false ||
        p.status === "failed" ||
        Number(p.exit_code || 0) !== 0)
    )
      errors++;
    let u;
    try {
      const info = p.info;
      if (info?.total_token_usage) {
        const total = normalizeUsage(info.total_token_usage);
        if (cumulative && total.total_tokens === cumulative.total_tokens)
          continue;
        if (cumulative && total.total_tokens > cumulative.total_tokens) {
          u = Object.fromEntries(
            Object.keys(total).map((k) => [
              k,
              Math.max(0, total[k] - cumulative[k]),
            ]),
          );
          u.cached_input_tokens = Math.min(
            u.cached_input_tokens,
            u.input_tokens,
          );
          u.reasoning_output_tokens = Math.min(
            u.reasoning_output_tokens,
            u.output_tokens,
          );
        } else u = total;
        cumulative = total;
      } else {
        const candidate =
          info?.last_token_usage ||
          event.usage ||
          p.usage ||
          event.response?.usage;
        if (!candidate) continue;
        u = normalizeUsage(candidate);
      }
    } catch {
      invalid++;
      continue;
    }
    if (!u.total_tokens) continue;
    const fingerprint = `${lastSeen}:${JSON.stringify(u)}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    index++;
    if (lastSeen < cutoff) {
      tools = errors = 0;
      continue;
    }
    const project = projectFromPath(projectPath);
    items.push({
      project: { ...project, firstSeen: startedAt, lastSeen },
      thread: {
        id: String(threadId),
        projectId: project.id,
        title: `${project.name} / ${String(threadId).slice(0, 8)}`,
        source: "codex-session",
        model,
        status: "observed",
        startedAt,
        endedAt: lastSeen,
        lastSeen,
      },
      turn: {
        id: stableId(`${threadId}:${index}:${fingerprint}`),
        threadId: String(threadId),
        projectId: project.id,
        occurredAt: lastSeen,
        source: "codex-session",
        model,
        inputTokens: u.input_tokens,
        cachedInputTokens: u.cached_input_tokens,
        outputTokens: u.output_tokens,
        reasoningOutputTokens: u.reasoning_output_tokens,
        sourceTotal: u.total_tokens,
        toolEvents: tools,
        errorEvents: Math.min(errors, tools),
        durationMs: Number.isFinite(event.duration_ms)
          ? event.duration_ms
          : null,
        rawUsageHash: stableId(JSON.stringify(u)),
        sourceFile: file,
      },
    });
    tools = errors = 0;
  }
  return { items, invalid };
}
