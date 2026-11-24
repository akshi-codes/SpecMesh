import { allRows, getDb } from "./db.js";
import { validatePack } from "./teams.js";

const legacyTables = [
  "projects",
  "threads",
  "turns",
  "budgets",
  "annotations",
  "preferences",
  "alerts",
  "alert_state",
  "ingested_files",
  "ingest_runs",
];
const workspaceTables = [
  "users",
  "teams",
  "memberships",
  "invitations",
  "work_tasks",
  "task_threads",
  "workflows",
  "task_metrics",
  "review_notes",
];
const tables = [...legacyTables, ...workspaceTables];
export function createBackup() {
  const db = getDb();
  db.exec("SAVEPOINT snapshot");
  try {
    return {
      format: "token-monitor",
      version: 3,
      createdAt: new Date().toISOString(),
      tables: Object.fromEntries(
        tables.map((t) => [t, allRows(`SELECT * FROM ${t}`)]),
      ),
    };
  } finally {
    db.exec("RELEASE snapshot");
  }
}
export function restoreBackup(body, validatePreferences) {
  const fail = () => {
    throw Object.assign(
      new Error(
        "Invalid backup. Use a complete Token Monitor v2 or Companion v3 export.",
      ),
      { statusCode: 400 },
    );
  };
  if (
    body?.format !== "token-monitor" ||
    ![2, 3].includes(body.version) ||
    !body.tables ||
    Object.keys(body.tables).sort().join(",") !==
      [...(body.version === 2 ? legacyTables : tables)].sort().join(",")
  )
    fail();
  const db = getDb();
  const restoring = body.version === 2 ? legacyTables : tables;
  if (body.version === 2 && allRows("SELECT id FROM work_tasks LIMIT 1").length)
    throw Object.assign(
      new Error(
        "A legacy backup cannot replace usage while linked tasks exist. Use a Companion v3 backup.",
      ),
      { statusCode: 400 },
    );
  for (const table of restoring) {
    const rows = body.tables[table],
      columns = allRows(`PRAGMA table_info(${table})`);
    if (!Array.isArray(rows) || rows.length > 500000) fail();
    for (const row of rows) {
      if (
        !row ||
        Object.keys(row).sort().join(",") !==
          columns
            .map((c) => c.name)
            .sort()
            .join(",")
      )
        fail();
      for (const c of columns) {
        const v = row[c.name];
        if (v === null) {
          if (c.notnull) fail();
          continue;
        }
        if (
          c.type === "INTEGER"
            ? !Number.isSafeInteger(v) || v < 0
            : typeof v !== "string"
        )
          fail();
        // JSON encoding can expand otherwise valid model names and evidence IDs.
        const textLimit =
          table === "task_metrics" && c.name === "snapshot"
            ? 100000
            : table === "workflows" && c.name === "task_ids"
              ? 200000
              : 10000;
        if (typeof v === "string" && v.length > textLimit) fail();
      }
    }
  }
  for (const r of body.tables.preferences) {
    try {
      validatePreferences({ [r.key]: JSON.parse(r.value) });
    } catch {
      fail();
    }
  }
  for (const r of body.tables.annotations) {
    try {
      const tags = JSON.parse(r.tags);
      if (
        !["thread", "project"].includes(r.kind) ||
        !Array.isArray(tags) ||
        tags.some((t) => typeof t !== "string")
      )
        fail();
    } catch {
      fail();
    }
  }
  if (body.version === 3) {
    try {
      const users = new Set(body.tables.users.map((r) => r.id));
      const teams = new Set(body.tables.teams.map((r) => r.id));
      const tasks = new Map(body.tables.work_tasks.map((r) => [r.id, r]));
      const collectors = new Set(
        body.tables.users.filter((r) => r.collector === 1).map((r) => r.id),
      );
      if (users.size && collectors.size !== 1) fail();
      for (const teamId of teams)
        if (
          !body.tables.memberships.some(
            (m) => m.team_id === teamId && m.role === "lead",
          )
        )
          fail();
      for (const row of body.tables.users) {
        if (
          !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(row.password_hash) ||
          ![0, 1].includes(row.collector)
        )
          fail();
      }
      for (const row of [...tasks.values(), ...body.tables.workflows]) {
        if (
          !users.has(row.owner_id) ||
          (row.team_id &&
            (!teams.has(row.team_id) ||
              !body.tables.memberships.some(
                (m) => m.team_id === row.team_id && m.user_id === row.owner_id,
              )))
        )
          fail();
      }
      for (const row of body.tables.workflows) {
        const ids = JSON.parse(row.task_ids);
        if (!Array.isArray(ids) || ids.some((id) => !tasks.has(id))) fail();
      }
      const importedTasks = new Set(
        body.tables.task_metrics.map((r) => r.task_id),
      );
      for (const row of body.tables.task_threads) {
        const task = tasks.get(row.task_id);
        if (!task || !collectors.has(task.owner_id) || importedTasks.has(task.id))
          fail();
      }
      for (const row of body.tables.task_metrics) {
        const task = tasks.get(row.task_id);
        if (!task) fail();
        const { id, title, kind, status, rework, blocker, lesson, link } = task;
        validatePack({
          format: "codex-review",
          version: 1,
          origin: "backup",
          tasks: [
            {
              id,
              title,
              kind,
              status,
              rework,
              blocker,
              lesson,
              link,
              ...JSON.parse(row.snapshot),
            },
          ],
        });
      }
    } catch {
      fail();
    }
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    if (body.version === 3) db.exec("DELETE FROM sessions");
    for (const t of [...restoring].reverse()) db.exec(`DELETE FROM ${t}`);
    for (const t of restoring) {
      const columns = allRows(`PRAGMA table_info(${t})`).map((c) => c.name);
      const stmt = db.prepare(
        `INSERT INTO ${t} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
      );
      for (const r of body.tables[t]) stmt.run(...columns.map((c) => r[c]));
    }
    db.exec("COMMIT");
    return { restored: true, turns: body.tables.turns.length };
  } catch {
    db.exec("ROLLBACK");
    fail();
  }
}
