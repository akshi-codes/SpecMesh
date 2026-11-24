import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  Plus,
  Upload,
  Users,
} from "lucide-react";
import { api, formatCompact } from "../lib/api.js";
import { Button } from "../components/ui.jsx";
import { Sheet, Field } from "../components/Interactions.jsx";
import { Blank, Status, statusLabel } from "./Workspace.jsx";
const kinds = [
  "feature",
  "debugging",
  "tests",
  "review",
  "refactoring",
  "learning",
  "other",
];
function TeamSelect({ teams, initial = "", disabled = false }) {
  return (
    <Field label="Visibility">
      <select name="team_id" defaultValue={initial} disabled={disabled}>
        <option value="">Private to me</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            Shared with {t.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
function ErrorText({ error }) {
  return error ? (
    <p role="alert" className="text-sm text-danger">
      {error}
    </p>
  ) : null;
}
export function TaskEditor({ task, user, teams, editable, onClose, onSave }) {
  const [threads, setThreads] = useState([]),
    [selected, setSelected] = useState(task.threadIds || []),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const own = !task.id || task.owner_id === user.id;
  useEffect(() => {
    if (!user.collector || !own || task.imported) return;
    const ctrl = new AbortController();
    api("/api/threads?range=all", { signal: ctrl.signal })
      .then(setThreads)
      .catch((e) => {
        if (!e.cancelled) setError(e.message);
      });
    return () => ctrl.abort();
  }, [user.collector, own, task.imported]);
  return (
    <Sheet
      title={task.id ? task.title : "A new piece of work"}
      onClose={onClose}
    >
      {task.metrics && (
        <div className="metric-strip">
          <div>
            <small>Tokens</small>
            <p className="text-2xl">
              {formatCompact(task.metrics.total_tokens)}
            </p>
          </div>
          <div>
            <small>Usage events</small>
            <p className="text-2xl">{task.metrics.turns}</p>
          </div>
          <div>
            <small>Evidence</small>
            <p className="text-sm mt-2">
              {task.imported ? "Imported snapshot" : "Linked local sessions"}
            </p>
          </div>
        </div>
      )}
      <p className="text-xs text-mutedForeground">
        Tool-failure coverage: {task.coverage || "unavailable"}. Missing
        observations do not mean there were no failures. Outcomes are recorded
        by people.
      </p>
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const b = Object.fromEntries(new FormData(e.currentTarget));
          if (own && !task.imported && user.collector) b.threadIds = selected;
          if (!own) b.team_id = task.team_id;
          try {
            await onSave(b);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={!editable || busy} className="space-y-5">
          <Field label="Task name">
            <input
              name="title"
              required
              maxLength={160}
              defaultValue={task.title || ""}
              placeholder="What are you trying to accomplish?"
            />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Type of work">
              <select name="kind" defaultValue={task.kind || "feature"}>
                {kinds.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </Field>
            <Field label="Outcome">
              <select name="status" defaultValue={task.status || "working"}>
                {Object.entries(statusLabel).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Rework required">
              <select name="rework" defaultValue={task.rework || "unrecorded"}>
                {["unrecorded", "none", "minor", "substantial"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </Field>
            <TeamSelect teams={teams} initial={task.team_id} disabled={!own} />
          </div>
          <Field label="What is blocking progress?">
            <textarea
              name="blocker"
              rows={2}
              maxLength={4000}
              defaultValue={task.blocker || ""}
              placeholder="A concrete next step someone can help with"
            />
          </Field>
          <Field label="What helped? What would you change?">
            <textarea
              name="lesson"
              rows={3}
              maxLength={4000}
              defaultValue={task.lesson || ""}
              placeholder="Capture a lesson for the next person"
            />
          </Field>
          <Field label="Issue or pull request link (optional)">
            <input
              name="link"
              type="url"
              maxLength={1000}
              defaultValue={task.link || ""}
              placeholder="https://…"
            />
          </Field>
          {user.collector && own && !task.imported && (
            <section>
              <h3 className="font-semibold mb-2">
                Link sessions{" "}
                <span className="text-mutedForeground text-sm">
                  ({selected.length} selected)
                </span>
              </h3>
              <Field label="Find sessions">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search project or thread…"
                />
              </Field>
              <div className="thread-picker mt-2">
                {threads
                  .filter((t) =>
                    `${t.title} ${t.project_name}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((t) => (
                    <label key={t.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(t.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, t.id]
                              : selected.filter((id) => id !== t.id),
                          )
                        }
                      />
                      <span>
                        <strong>{t.title}</strong>
                        <small>
                          {t.project_name} · {formatCompact(t.tokens)} tokens
                        </small>
                      </span>
                    </label>
                  ))}
                {!threads.length && (
                  <p>
                    No sessions yet. Sync your local usage from Usage → Sync
                    now.
                  </p>
                )}
              </div>
              <p className="text-xs text-mutedForeground mt-2">
                A session belongs to one task to avoid counting it twice. Shared
                tasks expose aggregate metrics, not raw session content.
              </p>
            </section>
          )}
        </fieldset>
        <ErrorText error={error} />
        {editable ? (
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save task"}
          </Button>
        ) : (
          <p className="text-sm text-mutedForeground">
            The task owner or a team lead can update this work.
          </p>
        )}
      </form>
    </Sheet>
  );
}
export function PlaybookEditor({
  value,
  user,
  tasks,
  teams,
  editable,
  onClose,
  onSave,
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(value.taskIds || []);
  return (
    <Sheet
      title={value.title || "Capture a repeatable approach"}
      onClose={onClose}
    >
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave({
              ...Object.fromEntries(new FormData(e.currentTarget)),
              taskIds: selected,
            });
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={!editable || busy} className="space-y-5">
          <Field label="Playbook title">
            <input
              name="title"
              required
              maxLength={160}
              defaultValue={value.title || ""}
            />
          </Field>
          <TeamSelect teams={teams} initial={value.team_id} disabled={!!value.id && value.owner_id !== user.id} />
          {[
            ["situation", "When to use this"],
            ["steps", "Steps to follow"],
            ["validation", "How to validate the result"],
            ["limitations", "Limitations and things to avoid"],
          ].map(([k, label]) => (
            <Field key={k} label={label}>
              <textarea
                name={k}
                required={k === "steps"}
                rows={k === "steps" ? 5 : 2}
                maxLength={8000}
                defaultValue={value[k] || ""}
              />
            </Field>
          ))}
          <h3 className="font-semibold">Supporting tasks</h3>
          <div className="thread-picker">
            {tasks.map((t) => (
              <label key={t.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(t.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, t.id]
                        : selected.filter((id) => id !== t.id),
                    )
                  }
                />
                <span>{t.title}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <ErrorText error={error} />
        {editable && (
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save playbook"}
          </Button>
        )}
      </form>
    </Sheet>
  );
}
export function Comparison({ tasks, onOpen }) {
  const [left, setLeft] = useState(""),
    [right, setRight] = useState("");
  const a = tasks.find((t) => t.id === left),
    b = tasks.find((t) => t.id === right);
  if (tasks.length < 2)
    return (
      <Blank title="Two examples make a comparison">
        Create or import at least two tasks. Compare similar work and consider
        the recorded outcome alongside usage.
      </Blank>
    );
  const rows = [
    ["Type", (t) => t.kind],
    ["Outcome", (t) => statusLabel[t.status]],
    ["Rework", (t) => t.rework],
    ["Tokens", (t) => formatCompact(t.metrics.total_tokens)],
    ["Events", (t) => t.metrics.turns],
    ["Models", (t) => t.models.join(", ") || "Unrecorded"],
    ["Failure coverage", (t) => t.coverage],
    [
      "Observed failures",
      (t) =>
        t.coverage === "unavailable" ? "Unavailable" : t.metrics.error_events,
    ],
    ["Lesson", (t) => t.lesson || "Not recorded"],
  ];
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-5 mb-6">
        {[
          ["First task", left, setLeft],
          ["Second task", right, setRight],
        ].map(([label, v, set]) => (
          <Field key={label} label={label}>
            <select value={v} onChange={(e) => set(e.target.value)}>
              <option value="">Choose a task</option>
              {tasks.map((t) => (
                <option value={t.id} key={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </Field>
        ))}
      </div>
      {a && b ? (
        a.id === b.id ? (
          <p role="alert">Choose two different tasks.</p>
        ) : (
          <>
            <p className="work-hint">
              {a.kind !== b.kind
                ? "These tasks have different types. Treat the comparison as exploratory."
                : "A comparison of two recorded examples, not a model ranking."}{" "}
              Different task difficulty, context, and validation affect the
              result.
            </p>
            <div className="overflow-x-auto">
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>Evidence</th>
                    <th>
                      <button onClick={() => onOpen(a)}>{a.title}</button>
                    </th>
                    <th>
                      <button onClick={() => onOpen(b)}>{b.title}</button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([label, read]) => (
                    <tr key={label}>
                      <th>{label}</th>
                      <td>{read(a)}</td>
                      <td>{read(b)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : (
        <Blank title="Choose work worth comparing">
          Compare approaches to similar tasks, then inspect the evidence behind
          each outcome.
        </Blank>
      )}
    </>
  );
}
export function TeamPanel({ teams, tasks, user, mutate, notify }) {
  const [selected, setSelected] = useState(""),
    [invite, setInvite] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const team = teams.find((t) => t.id === selected) || teams[0];
  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const teamTasks = tasks.filter((t) => t.team_id === team?.id);
  return (
    <>
      <div className="team-forms">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = new FormData(e.currentTarget).get("name");
            void run(async () => {
              const r = await mutate("/api/workspace/teams", { name });
              setSelected(r.id);
              setInvite("");
              notify("Team created. You are the team lead.");
            });
          }}
        >
          <Field label="Start a team">
            <input
              name="name"
              required
              maxLength={80}
              placeholder="Your team’s name"
            />
          </Field>
          <Button type="submit" disabled={busy}>
            <Plus size={15} />
            Create team
          </Button>
        </form>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const invite = new FormData(e.currentTarget).get("invite");
            void run(async () => {
              await mutate("/api/auth/join", { invite });
              notify("You joined the team.");
            });
          }}
        >
          <Field label="Join another team">
            <input
              name="invite"
              required
              placeholder="Paste an invitation code"
            />
          </Field>
          <Button type="submit" disabled={busy} variant="secondary">
            Join
          </Button>
        </form>
      </div>
      <ErrorText error={error} />
      {team ? (
        <>
          <div className="work-section-heading mt-8">
            <label className="text-xl font-semibold">
              <select
                className="bg-transparent"
                aria-label="Select team"
                value={team.id}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setInvite("");
                }}
              >
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            {team.role === "lead" && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const result = await mutate(
                      `/api/workspace/teams/${team.id}/invite`,
                      {},
                    );
                    setInvite(result.token);
                  })
                }
              >
                Create invitation
              </Button>
            )}
          </div>
          {invite && (
            <div className="work-hint">
              <p>
                Share this single-use code with one colleague. It expires in
                seven days.
              </p>
              <div className="flex gap-3 mt-3">
                <input
                  aria-label="Invitation code"
                  className="flex-1 min-w-0 font-mono text-xs bg-transparent"
                  value={invite}
                  readOnly
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(invite)
                      .then(() => notify("Invitation copied."))
                      .catch(() =>
                        setError(
                          "Select and copy the invitation code manually.",
                        ),
                      )
                  }
                >
                  <Copy size={14} />
                  Copy
                </Button>
              </div>
            </div>
          )}
          <div className="work-metrics">
            {[
              ["Shared tasks", teamTasks.length],
              [
                "Blocked",
                teamTasks.filter((t) => t.status === "blocked").length,
              ],
              [
                "Completed",
                teamTasks.filter((t) => t.status === "completed").length,
              ],
              [
                "Shared token usage",
                formatCompact(
                  teamTasks.reduce((n, t) => n + t.metrics.total_tokens, 0),
                ),
              ],
            ].map(([label, n]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{n}</strong>
              </div>
            ))}
          </div>
          <p className="work-hint">
            Only explicitly shared tasks are included. Imported usage is a
            snapshot; this is not a complete picture of anyone’s activity or
            productivity.
          </p>
          <div className="overflow-x-auto">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Team member</th>
                  <th>Role</th>
                  <th>Shared tasks</th>
                  <th>Blocked</th>
                  <th>Completed</th>
                  <th>Shared tokens</th>
                </tr>
              </thead>
              <tbody>
                {team.members.map((m) => {
                  const own = teamTasks.filter((t) => t.owner_id === m.id);
                  return (
                    <tr key={m.id}>
                      <th>
                        {m.name}
                        {m.id === user.id ? " (you)" : ""}
                      </th>
                      <td>
                        {team.role === "lead" ? (
                          <select
                            aria-label={`Role for ${m.name}`}
                            value={m.role}
                            disabled={busy}
                            onChange={(e) =>
                              run(() =>
                                mutate(
                                  `/api/workspace/teams/${team.id}/members/${m.id}`,
                                  { role: e.target.value },
                                  "PUT",
                                ),
                              )
                            }
                          >
                            <option value="member">Member</option>
                            <option value="lead">Lead</option>
                          </select>
                        ) : (
                          m.role
                        )}
                      </td>
                      <td>{own.length}</td>
                      <td>
                        {own.filter((t) => t.status === "blocked").length}
                      </td>
                      <td>
                        {own.filter((t) => t.status === "completed").length}
                      </td>
                      <td>
                        {formatCompact(
                          own.reduce((n, t) => n + t.metrics.total_tokens, 0),
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <Blank title="Bring your team together">
          Create a team to become its lead, or join with an invitation from a
          colleague.
        </Blank>
      )}
    </>
  );
}
export function WeeklyReview({ tasks, reviews, onOpen, mutate }) {
  const [days, setDays] = useState(7),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const recent = tasks.filter(
    (t) => Date.parse(t.updated_at) >= Date.now() - days * 86400000,
  );
  return (
    <>
      <div className="flex justify-between mb-5">
        <p className="text-sm text-mutedForeground">
          Based on task updates, including imported snapshots.
        </p>
        <select
          aria-label="Review period"
          className="select-control"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>
      <ErrorText error={error} />
      {recent.length ? (
        recent.map((t) => {
          const reviewed = reviews.find((r) => r.task_id === t.id);
          const current = reviewed && reviewed.reviewed_at >= t.updated_at;
          return (
            <article className="review-entry" key={t.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  className="font-semibold text-left"
                  onClick={() => onOpen(t)}
                >
                  {t.title}
                </button>
                <Status value={t.status} />
              </div>
              <p className="text-sm text-mutedForeground mt-2">
                {t.status === "blocked"
                  ? t.blocker || "Ask what would unblock this task."
                  : t.rework === "substantial"
                    ? "Substantial rework recorded. Review the approach and validation steps."
                    : t.lesson || "Capture a lesson while the work is fresh."}
              </p>
              <form
                className="mt-4 flex flex-wrap items-end gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(t.id);
                  setError("");
                  try {
                    await mutate(
                      "/api/workspace/reviews/" + t.id,
                      { note: new FormData(e.currentTarget).get("note") },
                      "PUT",
                    );
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <Field label="Your follow-up note">
                  <input
                    name="note"
                    maxLength={4000}
                    defaultValue={reviewed?.note || ""}
                    placeholder="A next step or a lesson to share"
                  />
                </Field>
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={!!busy}
                >
                  {busy === t.id ? (
                    "Saving…"
                  ) : current ? (
                    <>
                      <Check size={14} />
                      Reviewed
                    </>
                  ) : (
                    "Mark reviewed"
                  )}
                </Button>
              </form>
            </article>
          );
        })
      ) : (
        <Blank title="Nothing updated in this period">
          Task outcomes and lessons will give your next review something
          concrete to discuss.
        </Blank>
      )}
    </>
  );
}
function download(value) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "codex-review-pack.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PackPanel({ tasks, teams, mutate, notify }) {
  const [selected, setSelected] = useState([]),
    [preview, setPreview] = useState(null),
    [incoming, setIncoming] = useState(null),
    [team, setTeam] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-8">
      <ErrorText error={error} />
      <section className="work-surface">
        <h2>Export selected work</h2>
        <p className="workspace-description">
          Includes selected task notes, outcomes, and aggregate metrics. No raw
          prompts, replies, session paths, or credentials.
        </p>
        <div className="thread-picker mt-5">
          {tasks.map((t) => (
            <label key={t.id}>
              <input
                type="checkbox"
                checked={selected.includes(t.id)}
                onChange={(e) => {
                  setSelected(
                    e.target.checked
                      ? [...selected, t.id]
                      : selected.filter((id) => id !== t.id),
                  );
                  setPreview(null);
                }}
              />
              <span>{t.title}</span>
            </label>
          ))}
          {!tasks.length && (
            <p>
              Create a task first, or import a contribution from your laptop.
            </p>
          )}
        </div>
        <Button
          className="mt-4"
          variant="secondary"
          disabled={!selected.length || busy}
          onClick={() =>
            run(async () =>
              setPreview(
                await api("/api/workspace/export", {
                  method: "POST",
                  body: JSON.stringify({ taskIds: selected }),
                }),
              ),
            )
          }
        >
          Preview export
        </Button>
        {preview && (
          <div className="mt-4">
            <p className="text-sm mb-3">
              Inspect the exact content before sharing. Your notes may contain
              information you do not want to disclose.
            </p>
            <pre className="pack-preview">
              {JSON.stringify(preview, null, 2)}
            </pre>
            <Button className="mt-3" onClick={() => download(preview)}>
              <Download size={16} />
              Download reviewed pack
            </Button>
          </div>
        )}
      </section>
      <section className="work-surface">
        <h2>Contribute from your laptop</h2>
        <p className="workspace-description">
          The shared server cannot read files on your computer. Run the included
          local export helper, review its output, and upload the resulting file
          here.
        </p>
        <code className="block text-xs bg-muted rounded-lg p-4 my-4 overflow-x-auto">
          node scripts/export-review-pack.js --title "My task" --from 2026-11-01
          --to 2026-11-01
        </code>
        <p className="text-xs text-mutedForeground mb-4">
          Use your task’s dates. Add --threads with comma-separated thread IDs
          to narrow the contribution. The helper writes a local file and sends
          nothing.
        </p>
        <Field label="Choose a review pack">
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              setIncoming(null);
              setConfirmed(false);
              if (file)
                void run(async () => {
                  if (file.size > 5 * 1024 * 1024)
                    throw new Error("Choose a pack smaller than 5 MB.");
                  const value = JSON.parse(await file.text());
                  if (
                    value?.format !== "codex-review" ||
                    value.version !== 1 ||
                    !Array.isArray(value.tasks)
                  )
                    throw new Error("Choose a Codex review pack.");
                  setIncoming(value);
                });
            }}
          />
        </Field>
        {incoming && (
          <div className="space-y-4 mt-5">
            <p>
              {incoming.tasks.length} task(s). Reimporting the same
              contributor/task replaces its previous snapshot rather than adding
              it again.
            </p>
            <pre className="pack-preview">
              {JSON.stringify(incoming, null, 2)}
            </pre>
            <Field label="Share imported tasks with">
              <select
                value={team}
                onChange={(e) => {
                  setTeam(e.target.value);
                  setConfirmed(false);
                }}
              >
                <option value="">Only me</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I reviewed the content and want to import it with this visibility.
            </label>
            <Button
              disabled={!confirmed || busy}
              onClick={() =>
                run(async () => {
                  const r = await mutate("/api/workspace/import", {
                    pack: incoming,
                    teamId: team,
                    confirm: true,
                  });
                  setIncoming(null);
                  setConfirmed(false);
                  notify(`${r.imported} tasks imported.`);
                })
              }
            >
              <Upload size={15} />
              {busy ? "Importing…" : "Import contribution"}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
