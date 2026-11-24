import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { appConfig, defaultDbPath } from "./config.js";

let db;
const statements = new WeakMap();
export function statement(database, sql) {
  let cache = statements.get(database);
  if (!cache) {
    cache = new Map();
    statements.set(database, cache);
  }
  if (!cache.has(sql)) cache.set(sql, database.prepare(sql));
  return cache.get(sql);
}

export function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(appConfig.dbPath), { recursive: true });
    // VACUUM INTO includes committed WAL pages; never copy a live SQLite file.
    if (
      appConfig.dbPath === defaultDbPath &&
      !fs.existsSync(appConfig.dbPath) &&
      fs.existsSync(appConfig.legacyDbPath)
    ) {
      const legacy = new DatabaseSync(appConfig.legacyDbPath, {
        readOnly: true,
      });
      try {
        legacy.prepare("VACUUM INTO ?").run(appConfig.dbPath);
      } finally {
        legacy.close();
      }
    }
    db = new DatabaseSync(appConfig.dbPath);
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
    migrate(db);
  }
  return db;
}

export function closeDbForTests() {
  if (db) {
    db.close();
    db = undefined;
  }
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      model TEXT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      last_seen TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      source TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
      tool_events INTEGER NOT NULL DEFAULT 0,
      error_events INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      raw_usage_hash TEXT NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES threads(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS ingest_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      files_scanned INTEGER NOT NULL DEFAULT 0,
      turns_imported INTEGER NOT NULL DEFAULT 0,
      message TEXT
    );

    CREATE TABLE IF NOT EXISTS ingested_files (
      file_path TEXT PRIMARY KEY,
      file_size INTEGER NOT NULL,
      modified_ms INTEGER NOT NULL,
      last_status TEXT NOT NULL,
      turns_seen INTEGER NOT NULL DEFAULT 0,
      invalid_lines INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS budgets (
      scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'project')),
      scope_id TEXT NOT NULL,
      period TEXT NOT NULL CHECK(period IN ('weekly', 'monthly')),
      token_limit INTEGER NOT NULL CHECK(token_limit >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_type, scope_id, period)
    );

    CREATE INDEX IF NOT EXISTS idx_turns_occurred ON turns(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_turns_project ON turns(project_id);
    CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(project_id);
    CREATE INDEX IF NOT EXISTS idx_ingested_files_modified ON ingested_files(modified_ms);
  `);

  ensureColumn(
    database,
    "ingest_runs",
    "files_skipped",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    database,
    "ingest_runs",
    "files_failed",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    database,
    "ingest_runs",
    "denied_files",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    database,
    "ingest_runs",
    "invalid_lines",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    database,
    "ingest_runs",
    "duplicate_turns",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    database,
    "ingest_runs",
    "duration_ms",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(database, "turns", "source_file", "TEXT");
  ensureColumn(database, "turns", "source_total", "INTEGER");
  ensureColumn(
    database,
    "ingested_files",
    "parser_version",
    "INTEGER NOT NULL DEFAULT 1",
  );
  database.exec(`
    CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS annotations (kind TEXT NOT NULL, id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', bookmarked INTEGER NOT NULL DEFAULT 0, group_name TEXT NOT NULL DEFAULT '', PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, message TEXT NOT NULL, created_at TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, period TEXT NOT NULL, threshold INTEGER NOT NULL, dismissed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS alert_state (id TEXT PRIMARY KEY, exceeded INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_turns_thread_date ON turns(thread_id, occurred_at);
    CREATE TABLE IF NOT EXISTS work_tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL,
      status TEXT NOT NULL, rework TEXT NOT NULL, blocker TEXT NOT NULL,
      lesson TEXT NOT NULL, link TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS task_threads (
      task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL REFERENCES threads(id),
      PRIMARY KEY(task_id,thread_id), UNIQUE(thread_id)
    );
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, situation TEXT NOT NULL,
      steps TEXT NOT NULL, validation TEXT NOT NULL, limitations TEXT NOT NULL,
      task_ids TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, collector INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memberships (team_id TEXT NOT NULL REFERENCES teams(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('lead','member')), PRIMARY KEY(team_id,user_id));
    CREATE TABLE IF NOT EXISTS invitations (token_hash TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id), expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS task_metrics (task_id TEXT PRIMARY KEY REFERENCES work_tasks(id) ON DELETE CASCADE, snapshot TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS review_notes (user_id TEXT NOT NULL REFERENCES users(id), task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE, note TEXT NOT NULL, reviewed_at TEXT NOT NULL, PRIMARY KEY(user_id,task_id));
  `);
  for (const table of ["work_tasks", "workflows"]) {
    ensureColumn(database, table, "owner_id", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(database, table, "team_id", "TEXT NOT NULL DEFAULT ''");
  }
}

function ensureColumn(database, tableName, columnName, definition) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    database.exec(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`,
    );
  }
}

export function upsertProject(database, project) {
  statement(
    database,
    `
    INSERT INTO projects (id, name, path, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      last_seen = max(projects.last_seen, excluded.last_seen)
  `,
  ).run(
    project.id,
    project.name,
    project.path,
    project.firstSeen,
    project.lastSeen,
  );
}

export function upsertThread(database, thread) {
  statement(
    database,
    `
    INSERT INTO threads (id, project_id, title, source, model, status, started_at, ended_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      model = coalesce(excluded.model, threads.model),
      status = excluded.status,
      ended_at = coalesce(excluded.ended_at, threads.ended_at),
      last_seen = max(threads.last_seen, excluded.last_seen)
  `,
  ).run(
    thread.id,
    thread.projectId,
    thread.title,
    thread.source,
    thread.model ?? null,
    thread.status,
    thread.startedAt,
    thread.endedAt,
    thread.lastSeen,
  );
}

export function insertTurn(database, turn) {
  return statement(
    database,
    `
    INSERT OR IGNORE INTO turns (
      id, thread_id, project_id, occurred_at, source, model,
      input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens,
      tool_events, error_events, duration_ms, raw_usage_hash, source_file, source_total
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    turn.id,
    turn.threadId,
    turn.projectId,
    turn.occurredAt,
    turn.source,
    turn.model ?? null,
    turn.inputTokens,
    turn.cachedInputTokens,
    turn.outputTokens,
    turn.reasoningOutputTokens,
    turn.toolEvents,
    turn.errorEvents,
    turn.durationMs,
    turn.rawUsageHash,
    turn.sourceFile ?? null,
    turn.sourceTotal ?? null,
  );
}

export function allRows(sql, params = []) {
  return getDb()
    .prepare(sql)
    .all(...params);
}

export function oneRow(sql, params = []) {
  return getDb()
    .prepare(sql)
    .get(...params);
}
