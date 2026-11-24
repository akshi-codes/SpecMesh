import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { allRows, getDb, oneRow } from "./db.js";
const derive = promisify(scrypt);
export const hashToken = (s) => createHash("sha256").update(s).digest("hex");
export const reject = (message, statusCode = 400) => {
  throw Object.assign(new Error(message), { statusCode });
};
export function member(user, teamId, lead = false) {
  const m = oneRow(
    "SELECT role FROM memberships WHERE team_id=? AND user_id=?",
    [teamId, user.id],
  );
  if (!m || (lead && m.role !== "lead"))
    reject("You do not have access to this team.", 403);
  return m;
}
const failures = new Map();
export function registerAuth(app) {
  app.decorateRequest("user", null);
  app.addHook("onRequest", async (r, reply) => {
    if (!r.url.startsWith("/api/") || r.url.split("?")[0] === "/api/health")
      return;
    const cookie = /(?:^|;\s*)companion_session=([^;]+)/.exec(
      r.headers.cookie || "",
    )?.[1];
    if (cookie)
      r.user =
        oneRow(
          `SELECT u.id,u.name,u.username,u.collector FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`,
          [hashToken(cookie), new Date().toISOString()],
        ) || null;
    if (r.url.startsWith("/api/auth/")) return;
    if (!r.user) return reply.code(401).send({ error: "Sign in to continue." });
    if (!r.url.startsWith("/api/workspace/") && !r.user.collector)
      return reply
        .code(403)
        .send({
          error:
            "This installation’s local session data is private to its owner.",
        });
  });
  const session = (reply, user) => {
    const token = randomBytes(32).toString("hex");
    const db = getDb();
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(
      new Date().toISOString(),
    );
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
      hashToken(token),
      user.id,
      new Date(Date.now() + 7 * 86400000).toISOString(),
    );
    reply.header(
      "set-cookie",
      `companion_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.TOKEN_MONITOR_SECURE_COOKIE === "true" ? "; Secure" : ""}`,
    );
    return {
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        collector: !!user.collector,
      },
    };
  };
  app.get("/api/auth/me", async (r) => ({
    user: r.user,
    setup: !oneRow("SELECT id FROM users LIMIT 1"),
  }));
  app.post("/api/auth/register", async (r, reply) => {
    const b = r.body || {};
    if (
      typeof b.name !== "string" ||
      !b.name.trim() ||
      b.name.length > 80 ||
      typeof b.username !== "string" ||
      !/^[a-zA-Z0-9_.-]{3,60}$/.test(b.username || "") ||
      typeof b.password !== "string" ||
      b.password.length < 12 ||
      b.password.length > 200
    )
      reject(
        "Use a name, a username (3–60 characters), and a password of at least 12 characters.",
      );
    const first = !oneRow("SELECT id FROM users LIMIT 1");
    if (first && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(r.ip))
      reject("Create the installation owner on this computer first.", 403);
    const invite =
      !first &&
      oneRow(
        "SELECT * FROM invitations WHERE token_hash=? AND used=0 AND expires_at>?",
        [hashToken(String(b.invite || "")), new Date().toISOString()],
      );
    if (!first && !invite)
      reject("A valid, unused team invitation is required.", 403);
    const salt = randomBytes(16).toString("hex");
    const derived = await derive(b.password, salt, 64);
    const user = {
      id: randomUUID(),
      name: b.name.trim(),
      username: b.username.toLowerCase(),
      collector: first ? 1 : 0,
    };
    const db = getDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      if (first && oneRow("SELECT id FROM users LIMIT 1"))
        reject("Setup is already complete. Sign in.", 409);
      if (
        invite &&
        db
          .prepare(
            "UPDATE invitations SET used=1 WHERE token_hash=? AND used=0",
          )
          .run(invite.token_hash).changes !== 1
      )
        reject("Invitation already used.", 409);
      db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?)").run(
        user.id,
        user.name,
        user.username,
        `${salt}:${derived.toString("hex")}`,
        user.collector,
        new Date().toISOString(),
      );
      if (invite)
        db.prepare("INSERT INTO memberships VALUES (?,?,?)").run(
          invite.team_id,
          user.id,
          "member",
        );
      if (first)
        for (const table of ["work_tasks", "workflows"])
          db.prepare(`UPDATE ${table} SET owner_id=? WHERE owner_id=''`).run(
            user.id,
          );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      if (e.code?.startsWith("ERR_SQLITE"))
        reject("That username is unavailable.", 409);
      throw e;
    }
    return session(reply, user);
  });
  app.post("/api/auth/login", async (r, reply) => {
    const key = r.ip,
      recent = failures.get(key);
    if (recent && recent.until > Date.now() && recent.count >= 10)
      reject("Too many attempts. Try again in 10 minutes.", 429);
    const b = r.body || {};
    if (
      typeof b.username !== "string" ||
      typeof b.password !== "string" ||
      b.password.length > 200
    )
      reject("Invalid credentials.", 401);
    const u = oneRow("SELECT * FROM users WHERE username=?", [
      b.username.toLowerCase(),
    ]);
    const [salt, expected] = (
      u?.password_hash || `${"0".repeat(32)}:${"0".repeat(128)}`
    ).split(":");
    const actual = await derive(b.password, salt, 64);
    if (!u || !timingSafeEqual(actual, Buffer.from(expected, "hex"))) {
      if (failures.size > 1000) failures.clear();
      failures.set(key, {
        count: recent?.until > Date.now() ? recent.count + 1 : 1,
        until: Date.now() + 600000,
      });
      reject("Incorrect username or password.", 401);
    }
    failures.delete(key);
    return session(reply, u);
  });
  app.post("/api/auth/logout", async (r, reply) => {
    const token = /(?:^|;\s*)companion_session=([^;]+)/.exec(
      r.headers.cookie || "",
    )?.[1];
    if (token)
      getDb()
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .run(hashToken(token));
    reply.header(
      "set-cookie",
      "companion_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    );
    return { ok: true };
  });
  app.post("/api/auth/join", async (r) => {
    if (!r.user) reject("Sign in first.", 401);
    const inv = oneRow(
      "SELECT * FROM invitations WHERE token_hash=? AND used=0 AND expires_at>?",
      [hashToken(String(r.body?.invite || "")), new Date().toISOString()],
    );
    if (!inv) reject("Invitation is invalid or expired.");
    const db = getDb();
    db.exec("BEGIN");
    try {
      db.prepare("INSERT OR IGNORE INTO memberships VALUES (?,?,?)").run(
        inv.team_id,
        r.user.id,
        "member",
      );
      db.prepare("UPDATE invitations SET used=1 WHERE token_hash=?").run(
        inv.token_hash,
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { ok: true };
  });
}
