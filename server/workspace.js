import { randomUUID, randomBytes } from "node:crypto";
import { allRows, getDb, oneRow } from "./db.js";
import { usageRows, totals, costEstimate } from "./analytics.js";

import { member, hashToken, reject } from "./auth.js";
import { registerTeamApi } from "./teams.js";
function actor(r) {
  if (!r.user) reject("Sign in to continue.", 401);
  return r.user;
}
function visible(user, row) {
  return (
    row.owner_id === user.id ||
    (row.team_id &&
      !!oneRow("SELECT role FROM memberships WHERE team_id=? AND user_id=?", [
        row.team_id,
        user.id,
      ]))
  );
}
function editable(user, row) {
  if (row.owner_id !== user.id) {
    if (!row.team_id) reject("Not your task.", 403);
    member(user, row.team_id, true);
  }
}
export const taskKinds = [
  "feature",
  "debugging",
  "tests",
  "review",
  "refactoring",
  "learning",
  "other",
];
export const taskStatuses = [
  "working",
  "blocked",
  "completed",
  "partial",
  "abandoned",
];
const fail = (message, statusCode = 400) => {
  throw Object.assign(new Error(message), { statusCode });
};
function string(value, name, max, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    fail(`Invalid ${name}.`);
  return value.trim();
}
function ids(value) {
  if (
    !Array.isArray(value) ||
    value.length > 200 ||
    value.some((x) => typeof x !== "string" || x.length > 150)
  )
    fail("Invalid thread selection.");
  return [...new Set(value)];
}
export function listTasks(user) {
  const links = allRows("SELECT * FROM task_threads");
  const byThread = new Map();
  for (const row of usageRows()) {
    if (!byThread.has(row.thread_id)) byThread.set(row.thread_id, []);
    byThread.get(row.thread_id).push(row);
  }
  return allRows("SELECT * FROM work_tasks ORDER BY updated_at DESC")
    .filter((task) => visible(user, task))
    .map((task) => {
      const threadIds = links
        .filter((x) => x.task_id === task.id)
        .map((x) => x.thread_id);
      const rows = threadIds.flatMap((id) => byThread.get(id) || []);
      const snapshot = oneRow(
        "SELECT snapshot FROM task_metrics WHERE task_id=?",
        [task.id],
      );
      const imported = snapshot ? JSON.parse(snapshot.snapshot) : null;
      const { rates: _rates, ...costs } = imported
        ? { enabled: false }
        : costEstimate(rows);
      return {
        ...task,
        owner:
          oneRow("SELECT name FROM users WHERE id=?", [task.owner_id])?.name ||
          "Unknown",
        threadIds: task.owner_id === user.id ? threadIds : [],
        imported: !!imported,
        metrics: imported?.metrics || totals(rows),
        models: imported?.models || [
          ...new Set(rows.map((r) => r.model || "unknown")),
        ],
        costs,
        coverage:
          imported?.coverage || (rows.length ? "partial" : "unavailable"),
      };
    });
}
function saveTask(user, id, body) {
  if (!body || typeof body !== "object") fail("Invalid task.");
  const old = id ? oneRow("SELECT * FROM work_tasks WHERE id=?", [id]) : null;
  if (id && !old) fail("Task not found.", 404);
  if (old) editable(user, old);
  const data = {
    team_id: "",
    title: "",
    kind: "feature",
    status: "working",
    rework: "unrecorded",
    blocker: "",
    lesson: "",
    link: "",
    ...old,
    ...body,
  };
  if (
    Object.keys(body).some(
      (k) =>
        ![
          "title",
          "kind",
          "status",
          "rework",
          "blocker",
          "lesson",
          "link",
          "threadIds",
          "team_id",
        ].includes(k),
    )
  )
    fail("Unknown task field.");
  if (typeof data.team_id !== "string") fail("Invalid team.");
  if (data.team_id) member(user, data.team_id);
  if (old && old.owner_id !== user.id && data.team_id !== old.team_id)
    fail("Only the owner can change sharing.", 403);
  data.title = string(data.title, "title", 160, true);
  for (const key of ["blocker", "lesson"])
    data[key] = string(data[key], key, 4000);
  data.link = string(data.link, "link", 1000);
  if (data.link && !/^https?:\/\//i.test(data.link))
    fail("Use an http or https issue/PR link.");
  if (
    !taskKinds.includes(data.kind) ||
    !taskStatuses.includes(data.status) ||
    !["unrecorded", "none", "minor", "substantial"].includes(data.rework)
  )
    fail("Invalid task outcome.");
  const threadIds = ids(
    body.threadIds ??
      (old
        ? allRows("SELECT thread_id FROM task_threads WHERE task_id=?", [
            id,
          ]).map((x) => x.thread_id)
        : []),
  );
  if (
    body.threadIds &&
    (!user.collector || (old && old.owner_id !== user.id))
  ) {
    if (body.threadIds.length)
      fail("Only the installation owner can link local sessions.", 403);
    if (old && old.owner_id !== user.id) delete body.threadIds;
  }
  if (
    old &&
    threadIds.length &&
    oneRow("SELECT task_id FROM task_metrics WHERE task_id=?", [id])
  )
    fail("Imported snapshots cannot link local sessions.");
  for (const thread of threadIds) {
    if (!oneRow("SELECT id FROM threads WHERE id=?", [thread]))
      fail("A selected thread no longer exists.");
    const linked = oneRow(
      "SELECT task_id FROM task_threads WHERE thread_id=?",
      [thread],
    );
    if (linked && linked.task_id !== id)
      fail(
        "A thread already belongs to another task. Unlink it there first.",
        409,
      );
  }
  const now = new Date().toISOString();
  id ||= randomUUID();
  const complete =
    data.status === "completed" ? old?.completed_at || now : null;
  const db = getDb();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO work_tasks(id,title,kind,status,rework,blocker,lesson,link,created_at,updated_at,completed_at,owner_id,team_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,kind=excluded.kind,status=excluded.status,rework=excluded.rework,blocker=excluded.blocker,lesson=excluded.lesson,link=excluded.link,updated_at=excluded.updated_at,completed_at=excluded.completed_at,team_id=excluded.team_id`,
    ).run(
      id,
      data.title,
      data.kind,
      data.status,
      data.rework,
      data.blocker,
      data.lesson,
      data.link,
      old?.created_at || now,
      now,
      complete,
      old?.owner_id || user.id,
      data.team_id,
    );
    if (!old || old.owner_id === user.id) {
      db.prepare("DELETE FROM task_threads WHERE task_id=?").run(id);
      const insert = db.prepare("INSERT INTO task_threads VALUES (?,?)");
      for (const thread of threadIds) insert.run(id, thread);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { id };
}
export function registerWorkspaceApi(app) {
  registerTeamApi(app);
  app.get("/api/workspace/tasks", async (r) => listTasks(actor(r)));
  app.post("/api/workspace/tasks", async (r) =>
    saveTask(actor(r), null, r.body),
  );
  app.put("/api/workspace/tasks/:id", async (r) =>
    saveTask(actor(r), r.params.id, r.body),
  );
  app.get("/api/workspace/workflows", async (r) =>
    allRows("SELECT * FROM workflows ORDER BY updated_at DESC")
      .filter((w) => visible(actor(r), w))
      .map((w) => ({ ...w, taskIds: JSON.parse(w.task_ids) })),
  );
  app.post("/api/workspace/workflows", async (r) =>
    saveWorkflow(actor(r), null, r.body),
  );
  app.put("/api/workspace/workflows/:id", async (r) =>
    saveWorkflow(actor(r), r.params.id, r.body),
  );
}
function saveWorkflow(user, id, body) {
  const old = id ? oneRow("SELECT * FROM workflows WHERE id=?", [id]) : null;
  if (id && !old) fail("Workflow not found.", 404);
  if (
    !body ||
    Object.keys(body).some(
      (k) =>
        ![
          "title",
          "situation",
          "steps",
          "validation",
          "limitations",
          "taskIds",
          "team_id",
        ].includes(k),
    )
  )
    fail("Invalid workflow.");
  if (old) editable(user, old);
  const value = {
    team_id: "",
    situation: "",
    steps: "",
    validation: "",
    limitations: "",
    ...old,
    ...body,
  };
  if (typeof value.team_id !== "string") fail("Invalid team.");
  if (value.team_id) member(user, value.team_id);
  if (old && old.owner_id !== user.id && value.team_id !== old.team_id)
    fail("Only the owner can change sharing.", 403);
  const title = string(value.title, "title", 160, true);
  for (const key of ["situation", "steps", "validation", "limitations"])
    value[key] = string(value[key], key, 8000, key === "steps");
  const taskIds = ids(body.taskIds ?? (old ? JSON.parse(old.task_ids) : []));
  for (const task of taskIds)
    if (!listTasks(user).some((t) => t.id === task))
      fail("Evidence task not found.");
  const now = new Date().toISOString();
  id ||= randomUUID();
  getDb()
    .prepare(
      `INSERT INTO workflows(id,title,situation,steps,validation,limitations,task_ids,created_at,updated_at,owner_id,team_id) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,situation=excluded.situation,steps=excluded.steps,validation=excluded.validation,limitations=excluded.limitations,task_ids=excluded.task_ids,updated_at=excluded.updated_at,team_id=excluded.team_id`,
    )
    .run(
      id,
      title,
      value.situation,
      value.steps,
      value.validation,
      value.limitations,
      JSON.stringify(taskIds),
      old?.created_at || now,
      now,
      old?.owner_id || user.id,
      value.team_id,
    );
  return { id };
}
