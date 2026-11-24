import assert from "node:assert/strict";
import path from "node:path";
import Fastify from "fastify";
import { appConfig } from "../server/config.js";
import { registerAuth } from "../server/auth.js";
import { api } from "../src/lib/api.js";
import { registerApi } from "../server/api.js";
import { getDb } from "../server/db.js";
import { seed } from "./product-tests.js";
export function registerWorkspaceTests(test, withTempRoot) {
  test("review pack imports preserve unchanged reviews and reject duplicate local work", () =>
    withWorkspace(withTempRoot, async ({ send, owner, team }) => {
      const created = await send("POST", "/api/workspace/tasks", {
        title: "Local work", threadIds: ["fixture-thread"], team_id: team,
      });
      assert.equal(created.statusCode, 200, created.body);
      const ownId = created.json().id;
      const exported = (await send("POST", "/api/workspace/export", {
        taskIds: [ownId],
      })).json();
      const duplicate = await send("POST", "/api/workspace/import", {
        pack: exported, teamId: team, confirm: true,
      });
      assert.equal(duplicate.statusCode, 409, duplicate.body);
      assert.equal((await send("GET", "/api/workspace/tasks")).json().length, 1);

      const pack = structuredClone(exported);
      pack.origin = "developer-laptop";
      pack.tasks[0].status = "completed";
      for (const teamId of [{ id: team }, 7, []]) {
        const invalid = await send("POST", "/api/workspace/import", {
          pack, teamId, confirm: true,
        });
        assert.equal(invalid.statusCode, 400, invalid.body);
      }
      const imported = await send("POST", "/api/workspace/import", {
        pack, teamId: team, confirm: true,
      });
      assert.equal(imported.statusCode, 200, imported.body);
      const task = (await send("GET", "/api/workspace/tasks")).json().find((t) => t.imported);
      const oldTime = "2026-01-01T00:00:00.000Z";
      getDb().prepare("UPDATE work_tasks SET updated_at=?,completed_at=? WHERE id=?")
        .run(oldTime, oldTime, task.id);
      await send("PUT", "/api/workspace/reviews/" + task.id, { note: "Reviewed this contribution" });
      const reviewBefore = (await send("GET", "/api/workspace/reviews")).json()[0];
      const unchanged = await send("POST", "/api/workspace/import", {
        pack: { ...pack, createdAt: new Date().toISOString() }, teamId: team, confirm: true,
      });
      assert.equal(unchanged.statusCode, 200, unchanged.body);
      const again = (await send("GET", "/api/workspace/tasks")).json().find((t) => t.id === task.id);
      assert.equal(again.updated_at, oldTime, "identical data must not reopen the weekly review");
      assert.equal(again.completed_at, oldTime, "reimport must not move the completion date");
      assert.ok(reviewBefore.reviewed_at >= again.updated_at);

      pack.tasks[0].metrics.input_tokens += 20;
      pack.tasks[0].metrics.total_tokens += 20;
      const updated = await send("POST", "/api/workspace/import", {
        pack, teamId: team, confirm: true,
      });
      assert.equal(updated.statusCode, 200, updated.body);
      const changed = (await send("GET", "/api/workspace/tasks")).json().find((t) => t.id === task.id);
      assert.ok(changed.updated_at > oldTime);
      assert.equal(changed.completed_at, oldTime);
      assert.equal(changed.metrics.total_tokens, 150);
      assert.equal(changed.owner_id, owner.id);
    }));

  test("backup restore rejects broken workspace ownership before replacing data", () =>
    withWorkspace(withTempRoot, async ({ send, owner, team }) => {
      const created = await send("POST", "/api/workspace/tasks", {
        title: "Shared source", threadIds: ["fixture-thread"], team_id: team,
      });
      assert.equal(created.statusCode, 200, created.body);
      const backup = (await send("GET", "/api/backup")).json();
      for (const damage of [
        (b) => { b.tables.users[0].collector = 0; },
        (b) => { b.tables.memberships[0].role = "member"; },
        (b) => {
          b.tables.users.push({ ...b.tables.users[0], id: "second-owner", username: "second-owner" });
        },
        (b) => {
          b.tables.users.push({ ...b.tables.users[0], id: "member", username: "member", collector: 0 });
          b.tables.work_tasks[0].owner_id = "member";
          b.tables.work_tasks[0].team_id = "";
        },
        (b) => {
          b.tables.users.push({ ...b.tables.users[0], id: "other-lead", username: "other-lead", collector: 0 });
          b.tables.teams.push({ id: "no-owner-team", name: "Other", created_at: new Date().toISOString() });
          b.tables.memberships.push({ user_id: "other-lead", team_id: "no-owner-team", role: "lead" });
          b.tables.work_tasks[0].team_id = "no-owner-team";
        },
      ]) {
        const corrupt = structuredClone(backup);
        damage(corrupt);
        const response = await send("POST", "/api/restore", corrupt);
        assert.equal(response.statusCode, 400, response.body);
        assert.equal((await send("GET", "/api/auth/me")).json().user.id, owner.id,
          "validation failure must not replace data or invalidate sessions");
        assert.equal((await send("GET", "/api/workspace/tasks")).json()[0].title, "Shared source");
      }
    }));

  test("backup restore round-trips review snapshots with the supported model count", () =>
    withWorkspace(withTempRoot, async ({ send, team }) => {
      const local = await send("POST", "/api/workspace/tasks", { title: "Source" });
      const pack = (await send("POST", "/api/workspace/export", { taskIds: [local.json().id] })).json();
      pack.origin = "external-source";
      pack.tasks[0].models = Array.from({ length: 100 }, (_, i) => `model-${i}-`.padEnd(120, "x"));
      const imported = await send("POST", "/api/workspace/import", { pack, teamId: team, confirm: true });
      assert.equal(imported.statusCode, 200, imported.body);
      const backup = (await send("GET", "/api/backup")).json();
      assert.ok(backup.tables.task_metrics[0].snapshot.length > 10000);
      const restored = await send("POST", "/api/restore", backup);
      assert.equal(restored.statusCode, 200, restored.body);
    }));

  test("team identity, scoped tasks, lead permissions, review packs and backup recovery", () =>
    withTempRoot("companion-", async (root) => {
      appConfig.dbPath = path.join(root, "test.sqlite");
      appConfig.codexHome = path.join(root, "codex");
      seed("private-source", new Date(Date.now() - 1000).toISOString());
      const app = Fastify();
      registerAuth(app);
      registerApi(app);
      await app.ready();
      const send = (method, url, payload, cookie) =>
        app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });
      const signup = async (username, invite) => {
        const r = await send("POST", "/api/auth/register", {
          name: username,
          username,
          password: "test-only-password-123",
          invite,
        });
        assert.equal(r.statusCode, 200, r.body);
        return {
          cookie: r.headers["set-cookie"].split(";")[0],
          user: r.json().user,
        };
      };
      try {
        assert.equal(
          (await send("GET", "/api/workspace/tasks")).statusCode,
          401,
        );
        const lead = await signup("lead");
        const team = (
          await send(
            "POST",
            "/api/workspace/teams",
            { name: "Platform" },
            lead.cookie,
          )
        ).json().id;
        const invite = (
          await send(
            "POST",
            `/api/workspace/teams/${team}/invite`,
            {},
            lead.cookie,
          )
        ).json().token;
        const dev = await signup("developer", invite);
        assert.equal(
          (
            await send("POST", "/api/auth/register", {
              name: "outsider",
              username: "outsider",
              password: "test-only-password-123",
              invite,
            })
          ).statusCode,
          403,
        );
        assert.equal(
          (await send("GET", "/api/threads", null, dev.cookie)).statusCode,
          403,
        );
        assert.equal(
          (
            await send(
              "POST",
              `/api/workspace/teams/${team}/invite`,
              {},
              dev.cookie,
            )
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await send(
              "PUT",
              `/api/workspace/teams/${team}/members/${lead.user.id}`,
              { role: "member" },
              lead.cookie,
            )
          ).statusCode,
          400,
        );
        const create = async (body, cookie) => {
          const r = await send("POST", "/api/workspace/tasks", body, cookie);
          assert.equal(r.statusCode, 200, r.body);
          return r.json().id;
        };
        const own = await create(
          { title: "Private investigation", threadIds: ["fixture-thread"] },
          lead.cookie,
        );
        assert.equal(
          (await send("GET", "/api/workspace/tasks", null, dev.cookie)).json()
            .length,
          0,
        );
        const privateDev = await create(
          { title: "Private member task" },
          dev.cookie,
        );
        assert.equal(
          (
            await send(
              "PUT",
              "/api/workspace/tasks/" + privateDev,
              { title: "Unauthorized" },
              lead.cookie,
            )
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await send(
              "POST",
              "/api/workspace/tasks",
              { title: "Second link", threadIds: ["fixture-thread"] },
              lead.cookie,
            )
          ).statusCode,
          409,
        );
        assert.equal(
          (
            await send(
              "PUT",
              "/api/workspace/tasks/" + own,
              {
                team_id: team,
                status: "completed",
                lesson: "Use a minimal reproduction.",
              },
              lead.cookie,
            )
          ).statusCode,
          200,
        );
        const visible = (
          await send("GET", "/api/workspace/tasks", null, dev.cookie)
        ).json();
        assert.equal(
          visible.find((t) => t.id === own).metrics.total_tokens,
          130,
        );
        assert.deepEqual(visible.find((t) => t.id === own).threadIds, []);
        assert.equal(
          (
            await send(
              "PUT",
              "/api/workspace/tasks/" + own,
              { title: "Member edit" },
              dev.cookie,
            )
          ).statusCode,
          403,
        );
        const shared = await create(
          {
            title: "Shared blocked work",
            team_id: team,
            status: "blocked",
            blocker: "Need a test fixture",
          },
          dev.cookie,
        );
        assert.equal(
          (
            await send(
              "PUT",
              "/api/workspace/tasks/" + shared,
              { status: "working" },
              lead.cookie,
            )
          ).statusCode,
          200,
        );
        const pack = (
          await send(
            "POST",
            "/api/workspace/export",
            { taskIds: [own] },
            lead.cookie,
          )
        ).json();
        assert.equal(JSON.stringify(pack).includes("/fixture/"), false);
        assert.equal(JSON.stringify(pack).includes("fixture-thread"), false);
        const corrupt = structuredClone(pack);
        corrupt.tasks[0].prompt = "PRIVATE_CONTENT";
        assert.equal(
          (
            await send(
              "POST",
              "/api/workspace/import",
              { pack: corrupt, confirm: true, teamId: team },
              dev.cookie,
            )
          ).statusCode,
          400,
        );
        for (let i = 0; i < 2; i++)
          assert.equal(
            (
              await send(
                "POST",
                "/api/workspace/import",
                { pack, confirm: true, teamId: team },
                dev.cookie,
              )
            ).statusCode,
            200,
          );
        const imported = (
          await send("GET", "/api/workspace/tasks", null, dev.cookie)
        )
          .json()
          .filter((t) => t.imported);
        assert.equal(imported.length, 1);
        assert.equal(imported[0].coverage, "partial");
        assert.equal(imported[0].metrics.total_tokens, 130);
        assert.equal(
          (
            await send(
              "POST",
              "/api/workspace/workflows",
              {
                title: "Repeatable debugging",
                steps: "Reproduce, isolate, validate",
                taskIds: [shared],
                team_id: team,
              },
              dev.cookie,
            )
          ).statusCode,
          200,
        );
        assert.equal(
          (
            await send("GET", "/api/workspace/workflows", null, lead.cookie)
          ).json().length,
          1,
        );
        assert.equal(
          (
            await send(
              "PUT",
              "/api/workspace/reviews/" + shared,
              { note: "Pair on the fixture" },
              lead.cookie,
            )
          ).statusCode,
          200,
        );
        const backup = (
          await send("GET", "/api/backup", null, lead.cookie)
        ).json();
        assert.equal(backup.version, 3);
        const corruptBackup = structuredClone(backup);
        corruptBackup.tables.task_metrics[0].snapshot = "{broken";
        assert.equal(
          (await send("POST", "/api/restore", corruptBackup, lead.cookie))
            .statusCode,
          400,
        );
        assert.equal(
          (await send("GET", "/api/workspace/tasks", null, lead.cookie))
            .statusCode,
          200,
        );
        const restored = await send(
          "POST",
          "/api/restore",
          backup,
          lead.cookie,
        );
        assert.equal(restored.statusCode, 200, restored.body);
        assert.equal(
          (await send("GET", "/api/workspace/tasks", null, lead.cookie))
            .statusCode,
          401,
        );
        const login = await send("POST", "/api/auth/login", {
          username: "lead",
          password: "test-only-password-123",
        });
        assert.equal(login.statusCode, 200, login.body);
        const renewed = login.headers["set-cookie"].split(";")[0];
        assert.equal(
          (await send("GET", "/api/workspace/tasks", null, renewed))
            .json()
            .filter((t) => t.id === own).length,
          1,
        );
        assert.equal(
          (await send("GET", "/api/workspace/teams", null, renewed)).json()[0]
            .members.length,
          2,
        );
        const address = await app.listen({ host: "127.0.0.1", port: 0 });
        assert.deepEqual(
          await api(`${address}/api/auth/logout`, {
            method: "POST",
            headers: { cookie: renewed },
          }),
          { ok: true },
        );
        assert.equal(
          (await send("GET", "/api/workspace/tasks", null, renewed)).statusCode,
          401,
        );
      } finally {
        await app.close();
      }
    }));
}

async function withWorkspace(withTempRoot, fn) {
  return withTempRoot("workspace-audit-", async (root) => {
    appConfig.dbPath = path.join(root, "test.sqlite");
    appConfig.codexHome = path.join(root, "codex");
    seed("private-source", new Date(Date.now() - 1000).toISOString());
    const app = Fastify();
    registerAuth(app);
    registerApi(app);
    await app.ready();
    try {
      const registration = await app.inject({ method: "POST", url: "/api/auth/register", payload: {
        name: "Installation owner", username: "owner", password: "test-only-password-123",
      } });
      assert.equal(registration.statusCode, 200, registration.body);
      const cookie = registration.headers["set-cookie"].split(";")[0];
      const send = (method, url, payload) => app.inject({ method, url, payload, headers: { cookie } });
      const team = await send("POST", "/api/workspace/teams", { name: "Audit team" });
      assert.equal(team.statusCode, 200, team.body);
      return await fn({ send, owner: registration.json().user, team: team.json().id });
    } finally {
      await app.close();
    }
  });
}
