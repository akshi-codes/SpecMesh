import { randomUUID, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { allRows, oneRow, getDb } from "./db.js";
import { member, hashToken, reject } from "./auth.js";
import { listTasks, taskKinds, taskStatuses } from "./workspace.js";
const userOf = (r) => {
  if (!r.user) reject("Sign in first.", 401);
  return r.user;
};
const clean = (v, max = 160) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    reject("Invalid text.");
  return v.trim();
};
const metricKeys = [
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "tool_events",
  "error_events",
  "total_tokens",
  "turns",
  "threads",
  "projects",
];
export function validatePack(pack) {
  if (
    !pack ||
    pack.format !== "codex-review" ||
    pack.version !== 1 ||
    typeof pack.origin !== "string" ||
    !pack.origin.trim() ||
    pack.origin.length > 100 ||
    !Array.isArray(pack.tasks) ||
    !pack.tasks.length ||
    pack.tasks.length > 100
  )
    reject("Choose a Codex review pack containing 1–100 tasks.");
  if (
    Object.keys(pack).some(
      (k) => !["format", "version", "origin", "createdAt", "tasks"].includes(k),
    )
  )
    reject("Unexpected pack fields.");
  const ids = new Set();
  for (const t of pack.tasks) {
    if (
      !t ||
      Object.keys(t).some(
        (k) =>
          ![
            "id",
            "title",
            "kind",
            "status",
            "rework",
            "blocker",
            "lesson",
            "link",
            "metrics",
            "models",
            "coverage",
          ].includes(k),
      )
    )
      reject("Unexpected task fields.");
    clean(t.id, 150);
    clean(t.title);
    if (ids.has(t.id)) reject("Duplicate task IDs.");
    ids.add(t.id);
    if (
      !taskKinds.includes(t.kind) ||
      !taskStatuses.includes(t.status) ||
      !["unrecorded", "none", "minor", "substantial"].includes(t.rework)
    )
      reject("Invalid outcome.");
    for (const k of ["blocker", "lesson", "link"])
      if (
        typeof t[k] !== "string" ||
        t[k].length > (k === "link" ? 1000 : 4000)
      )
        reject("Invalid task notes.");
    if (t.link && !/^https?:\/\//i.test(t.link))
      reject("Invalid reference link.");
    if (
      !t.metrics ||
      Object.keys(t.metrics).sort().join() !== [...metricKeys].sort().join() ||
      metricKeys.some(
        (k) => !Number.isSafeInteger(t.metrics[k]) || t.metrics[k] < 0,
      )
    )
      reject("Invalid metrics.");
    const m = t.metrics;
    if (
      m.total_tokens !== m.input_tokens + m.output_tokens ||
      m.cached_input_tokens > m.input_tokens ||
      m.reasoning_output_tokens > m.output_tokens ||
      m.error_events > m.tool_events
    )
      reject("Metrics do not reconcile.");
    if (
      !Array.isArray(t.models) ||
      t.models.length > 100 ||
      t.models.some((m) => typeof m !== "string" || m.length > 120) ||
      !["partial", "unavailable"].includes(t.coverage)
    )
      reject("Invalid coverage or models.");
  }
  return pack;
}
export function registerTeamApi(app) {
  app.get("/api/workspace/teams", async (r) => {
    const user = userOf(r);
    return allRows(
      "SELECT t.*,m.role FROM teams t JOIN memberships m ON m.team_id=t.id WHERE m.user_id=?",
      [user.id],
    ).map((t) => ({
      ...t,
      members: allRows(
        "SELECT u.id,u.name,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.team_id=? ORDER BY m.role,u.name",
        [t.id],
      ),
    }));
  });
  app.post("/api/workspace/teams", async (r) => {
    const user = userOf(r),
      name = clean(r.body?.name, 80),
      id = randomUUID(),
      db = getDb();
    db.exec("BEGIN");
    try {
      db.prepare("INSERT INTO teams VALUES (?,?,?)").run(
        id,
        name,
        new Date().toISOString(),
      );
      db.prepare("INSERT INTO memberships VALUES (?,?,?)").run(
        id,
        user.id,
        "lead",
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { id };
  });
  app.post("/api/workspace/teams/:id/invite", async (r) => {
    member(userOf(r), r.params.id, true);
    const token = randomBytes(24).toString("hex");
    getDb()
      .prepare("INSERT INTO invitations VALUES (?,?,?,0)")
      .run(
        hashToken(token),
        r.params.id,
        new Date(Date.now() + 7 * 86400000).toISOString(),
      );
    return { token, expiresInDays: 7 };
  });
  app.put("/api/workspace/teams/:id/members/:userId", async (r) => {
    member(userOf(r), r.params.id, true);
    if (!["lead", "member"].includes(r.body?.role)) reject("Invalid role.");
    const target = oneRow(
      "SELECT role FROM memberships WHERE team_id=? AND user_id=?",
      [r.params.id, r.params.userId],
    );
    if (!target) reject("Member not found.", 404);
    if (
      target.role === "lead" &&
      r.body.role === "member" &&
      oneRow(
        "SELECT count(*) AS n FROM memberships WHERE team_id=? AND role='lead'",
        [r.params.id],
      ).n <= 1
    )
      reject("Keep at least one team lead.");
    getDb()
      .prepare("UPDATE memberships SET role=? WHERE team_id=? AND user_id=?")
      .run(r.body.role, r.params.id, r.params.userId);
    return { ok: true };
  });
  app.get("/api/workspace/reviews", async (r) =>
    allRows("SELECT * FROM review_notes WHERE user_id=?", [userOf(r).id]),
  );
  app.put("/api/workspace/reviews/:id", async (r) => {
    const user = userOf(r);
    if (!listTasks(user).some((t) => t.id === r.params.id))
      reject("Task not found.", 404);
    const note = typeof r.body?.note === "string" ? r.body.note : "";
    if (note.length > 4000) reject("Note is too long.");
    getDb()
      .prepare(
        "INSERT INTO review_notes VALUES (?,?,?,?) ON CONFLICT(user_id,task_id) DO UPDATE SET note=excluded.note,reviewed_at=excluded.reviewed_at",
      )
      .run(user.id, r.params.id, note, new Date().toISOString());
    return { ok: true };
  });
  app.post("/api/workspace/export", async (r) => {
    const user = userOf(r),
      ids = r.body?.taskIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100)
      reject("Select 1–100 tasks.");
    const own = listTasks(user).filter(
      (t) => t.owner_id === user.id && ids.includes(t.id),
    );
    if (own.length !== new Set(ids).size)
      reject("Export only your own tasks.", 403);
    return {
      format: "codex-review",
      version: 1,
      origin: user.id,
      createdAt: new Date().toISOString(),
      tasks: own.map((t) => ({
        id: t.id,
        title: t.title,
        kind: t.kind,
        status: t.status,
        rework: t.rework,
        blocker: t.blocker,
        lesson: t.lesson,
        link: t.link,
        metrics: t.metrics,
        models: t.models,
        coverage: t.coverage,
      })),
    };
  });
  app.post("/api/workspace/import", async (r) => {
    const user = userOf(r),
      pack = validatePack(r.body?.pack),
      teamId = r.body.teamId ?? "";
    if (typeof teamId !== "string") reject("Invalid team.");
    if (teamId) member(user, teamId);
    if (r.body.confirm !== true)
      reject("Preview and confirm the review pack first.");
    if (
      pack.origin === user.id &&
      pack.tasks.some((task) =>
        oneRow("SELECT id FROM work_tasks WHERE id=? AND owner_id=?", [
          task.id,
          user.id,
        ]),
      )
    )
      reject(
        "These tasks already exist in your workspace. Share or edit the original tasks instead.",
        409,
      );
    const db = getDb(),
      now = new Date().toISOString();
    db.exec("BEGIN");
    try {
      for (const t of pack.tasks) {
        const id = "import-" + hashToken(`${user.id}:${pack.origin}:${t.id}`);
        const old = oneRow(
          "SELECT w.*,m.snapshot FROM work_tasks w LEFT JOIN task_metrics m ON m.task_id=w.id WHERE w.id=?",
          [id],
        );
        const snapshot = {
          metrics: t.metrics,
          models: t.models,
          coverage: t.coverage,
        };
        const unchanged =
          old &&
          old.team_id === teamId &&
          ["title", "kind", "status", "rework", "blocker", "lesson", "link"].every(
            (key) => old[key] === t[key],
          ) &&
          isDeepStrictEqual(JSON.parse(old.snapshot || "null"), snapshot);
        // A repeated upload is not new work and must not reopen a completed review.
        if (unchanged) continue;
        db.prepare(
          `INSERT INTO work_tasks(id,title,kind,status,rework,blocker,lesson,link,created_at,updated_at,completed_at,owner_id,team_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,kind=excluded.kind,status=excluded.status,rework=excluded.rework,blocker=excluded.blocker,lesson=excluded.lesson,link=excluded.link,updated_at=excluded.updated_at,completed_at=excluded.completed_at,team_id=excluded.team_id`,
        ).run(
          id,
          t.title,
          t.kind,
          t.status,
          t.rework,
          t.blocker,
          t.lesson,
          t.link,
          now,
          now,
          t.status === "completed" ? old?.completed_at || now : null,
          user.id,
          teamId,
        );
        db.prepare(
          "INSERT INTO task_metrics VALUES (?,?) ON CONFLICT(task_id) DO UPDATE SET snapshot=excluded.snapshot",
        ).run(
          id,
          JSON.stringify(snapshot),
        );
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { imported: pack.tasks.length };
  });
}
