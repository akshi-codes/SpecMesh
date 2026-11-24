import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  ArrowUpRight,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Columns2,
  Download,
  Home,
  LogOut,
  Menu,
  Moon,
  Plus,
  Radar,
  Search,
  Sun,
  Upload,
  Users,
  X,
  BarChart3,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { api, formatCompact } from "../lib/api.js";
import { applyTheme } from "../lib/theme.js";
import { useStoredState } from "../hooks/useStoredState.js";
import { Button } from "../components/ui.jsx";
import { Field, Sheet } from "../components/Interactions.jsx";
import {
  TaskEditor,
  PlaybookEditor,
  Comparison,
  TeamPanel,
  PackPanel,
  WeeklyReview,
} from "./WorkspacePanels.jsx";
const Usage = lazy(() => import("../UsageWorkspace.jsx"));
const SpecMesh = lazy(() => import("./SpecMesh.jsx"));
const navigation = [
  ["home", "Home", Home],
  ["tasks", "Tasks", ClipboardList],
  ["team", "Team", Users],
  ["specmesh", "SpecMesh", Radar],
  ["compare", "Compare", Columns2],
  ["playbooks", "Playbooks", BookOpen],
  ["review", "Weekly review", CheckCircle2],
  ["exchange", "Review packs", Upload],
  ["usage", "Usage", BarChart3],
];
const route = () => {
  const p = new URLSearchParams(location.search);
  const id = p.get("page") || (p.has("view") ? "usage" : "home");
  return navigation.some(([key]) => key === id) ? id : "home";
};
export const statusLabel = {
  working: "In progress",
  blocked: "Blocked",
  completed: "Completed",
  partial: "Partially completed",
  abandoned: "Abandoned",
};
export function Status({ value }) {
  return (
    <span className={`work-status status-${value}`}>
      {statusLabel[value] || value}
    </span>
  );
}
export function Blank({ title, children, action }) {
  return (
    <div className="work-empty">
      <CircleHelp size={26} strokeWidth={1.4} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function TaskRows({ tasks, onOpen }) {
  return (
    <div className="work-list">
      {tasks.map((t) => (
        <button key={t.id} className="work-row" onClick={() => onOpen(t)}>
          <span className="task-icon">
            <ClipboardList size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate">{t.title}</strong>
            <small className="text-mutedForeground">
              {t.owner} · {t.kind} ·{" "}
              {t.imported
                ? "Imported snapshot"
                : `${t.metrics.threads} linked threads`}
            </small>
          </span>
          <Status value={t.status} />
          <span className="hidden sm:block font-mono text-xs text-mutedForeground">
            {formatCompact(t.metrics.total_tokens)} tokens
          </span>
          <ChevronRight size={16} />
        </button>
      ))}
    </div>
  );
}
export default function Workspace({ user, onLogout }) {
  const [page, setPage] = useState(route),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [scope, setScope] = useState("all"),
    [editor, setEditor] = useState(null),
    [playbook, setPlaybook] = useState(null),
    [mobile, setMobile] = useState(false),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const [theme, setTheme] = useStoredState("token-monitor-theme", "light");
  const reduce = useReducedMotion(),
    request = useRef(0),
    loading = useRef(false);
  const load = useCallback(async () => {
    const serial = ++request.current;
    loading.current = true;
    try {
      const [tasks, teams, workflows, reviews] = await Promise.all(
        ["tasks", "teams", "workflows", "reviews"].map((k) =>
          api("/api/workspace/" + k),
        ),
      );
      if (serial === request.current) {
        setData({ tasks, teams, workflows, reviews });
        setError("");
      }
    } catch (e) {
      if (e.status === 401) location.reload();
      if (serial === request.current) setError(e.message);
    } finally {
      if (serial === request.current) loading.current = false;
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!document.hidden && !loading.current) void load();
    }, 15000);
    return () => {
      clearInterval(timer);
      request.current++;
    };
  }, [load]);
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    const fn = () => setPage(route());
    addEventListener("popstate", fn);
    return () => removeEventListener("popstate", fn);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const go = (id) => {
    const p = new URLSearchParams(location.search);
    p.set("page", id);
    history.pushState(null, "", "?" + p);
    setPage(id);
    setMobile(false);
  };
  const mutate = async (path, body, method = "POST") => {
    const result = await api(path, { method, body: JSON.stringify(body) });
    await load();
    return result;
  };
  const scoped = (data?.tasks || []).filter(
    (t) =>
      scope === "all" ||
      (scope === "mine" ? t.owner_id === user.id : t.team_id === scope),
  );
  const canEdit = (t) =>
    t.owner_id === user.id ||
    data?.teams.some((team) => team.id === t.team_id && team.role === "lead");
  const open = (t) => setEditor(t);
  const links = (
    <nav aria-label="Workspace navigation">
      {navigation
        .filter(([id]) => id !== "usage" || user.collector)
        .map(([id, label, Icon]) => (
          <button
            key={id}
            aria-current={page === id ? "page" : undefined}
            onClick={() => go(id)}
          >
            <Icon size={18} strokeWidth={1.7} />
            <span>{label}</span>
            {page === id && <span className="nav-active-marker" />}
          </button>
        ))}
    </nav>
  );
  const title = navigation.find(([id]) => id === page)?.[1] || "Home";
  return (
    <MotionConfig reducedMotion="user">
      <div className="companion-shell">
        <a href="#workspace-content" className="skip-link">
          Skip to workspace
        </a>
        <aside className="companion-sidebar">
          <button className="companion-brand" onClick={() => go("home")}>
            <span>
              <Radar size={22} />
            </span>
            <div>
              Codex <strong>Companion</strong>
            </div>
          </button>
          <p className="sidebar-caption">YOUR WORKSPACE</p>
          {links}
          <div className="sidebar-bottom">
            <span className="avatar">
              {user.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>
                {user.collector ? "Installation owner" : "Team workspace"}
              </small>
            </div>
            <button
              aria-label="Sign out"
              onClick={() => onLogout().catch((e) => setError(e.message))}
            >
              <LogOut size={17} />
            </button>
          </div>
        </aside>
        <div className="companion-body">
          <header className="companion-topbar">
            <div className="flex items-center gap-3">
              <button
                className="lg:hidden"
                aria-label="Open workspace navigation"
                onClick={() => setMobile(true)}
              >
                <Menu size={20} />
              </button>
              <span className="text-mutedForeground text-sm">Workspace</span>
              <ChevronRight size={14} />
              <strong className="text-sm">{title}</strong>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden sm:block text-xs text-mutedForeground">
                Shared work. Clear outcomes.
              </span>
              <button
                aria-label={
                  theme === "dark" ? "Use light theme" : "Use dark theme"
                }
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="p-2 rounded-lg hover:bg-muted"
              >
                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            </div>
          </header>
          <main id="workspace-content" className="companion-content">
            {error && (
              <div role="alert" className="work-error">
                {error}
                <Button size="sm" onClick={load}>
                  Retry
                </Button>
              </div>
            )}
            {!data ? (
              <Blank title="Opening your workspace">
                Loading your tasks and team memberships.
              </Blank>
            ) : (
              <>
                {page !== "usage" && page !== "specmesh" && (
                  <div className="workspace-page-heading">
                    <div>
                      <p className="workspace-eyebrow">
                        {page === "home"
                          ? "MAKE THE NEXT SESSION COUNT"
                          : page === "team"
                            ? "A SHARED VIEW OF THE WORK"
                            : page === "review"
                              ? "TAKE STOCK, THEN MOVE FORWARD"
                              : "CODEX COMPANION"}
                      </p>
                      <h1>
                        {page === "home"
                          ? "Good work starts with context."
                          : title}
                      </h1>
                      <p className="workspace-description">
                        {page === "home"
                          ? "Bring your sessions together. See what’s moving, what’s blocked, and what the team can learn."
                          : page === "tasks"
                            ? "One place for the goal, the sessions, and the result."
                            : page === "team"
                              ? "Track the work your teammates choose to share."
                              : page === "compare"
                                ? "Compare the approach and the outcome, with usage as supporting evidence."
                                : page === "playbooks"
                                  ? "Keep the approaches that worked. Make them easier to repeat."
                                  : page === "review"
                                    ? "Review recent work and decide what to improve next."
                                    : "Share selected evidence without sharing your session content."}
                      </p>
                    </div>
                    {["home", "tasks"].includes(page) && (
                      <Button onClick={() => setEditor({})}>
                        <Plus size={16} />
                        New task
                      </Button>
                    )}
                  </div>
                )}
                {["home", "tasks", "compare", "review"].includes(page) && (
                  <div className="work-filterbar">
                    <label className="inline-flex gap-2 items-center text-sm">
                      <Users size={16} />
                      <select
                        aria-label="Workspace scope"
                        value={scope}
                        onChange={(e) => setScope(e.target.value)}
                        className="bg-transparent outline-none"
                      >
                        <option value="all">All accessible work</option>
                        <option value="mine">My tasks</option>
                        {data.teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="text-xs text-mutedForeground">
                      {scoped.length} tasks ·{" "}
                      {scope === "mine"
                        ? "Private and shared"
                        : "Shared tasks plus your private work"}
                    </span>
                  </div>
                )}
                <motion.div
                  key={page}
                  initial={reduce ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.12 }}
                >
                  {page === "home" && (
                    <>
                      <div className="work-metrics">
                        {[
                          [
                            "In progress",
                            scoped.filter((t) => t.status === "working").length,
                            "Keep the next step visible",
                          ],
                          [
                            "Need attention",
                            scoped.filter((t) => t.status === "blocked").length,
                            "Clear a blocker together",
                          ],
                          [
                            "Completed",
                            scoped.filter((t) => t.status === "completed")
                              .length,
                            "Developer-recorded outcomes",
                          ],
                          [
                            "Lessons captured",
                            scoped.filter((t) => t.lesson.trim()).length,
                            "Knowledge worth keeping",
                          ],
                        ].map(([label, value, note]) => (
                          <div key={label}>
                            <span>{label}</span>
                            <strong>{value}</strong>
                            <small>{note}</small>
                          </div>
                        ))}
                      </div>
                      <div className="work-home-grid">
                        <section>
                          <div className="work-section-heading">
                            <h2>In motion</h2>
                            <button onClick={() => go("tasks")}>
                              All tasks <ArrowUpRight size={15} />
                            </button>
                          </div>
                          {scoped.some((t) =>
                            ["working", "blocked"].includes(t.status),
                          ) ? (
                            <TaskRows
                              tasks={scoped
                                .filter((t) =>
                                  ["working", "blocked"].includes(t.status),
                                )
                                .slice(0, 6)}
                              onOpen={open}
                            />
                          ) : (
                            <Blank
                              title="Give your work a home"
                              action={
                                <Button size="sm" onClick={() => setEditor({})}>
                                  Create your first task
                                </Button>
                              }
                            >
                              Connect related sessions to a goal, then record
                              how it went.
                            </Blank>
                          )}
                        </section>
                        <aside className="work-attention">
                          <p className="workspace-eyebrow">NEXT ACTION</p>
                          <h2>
                            {scoped.some((t) => t.status === "blocked")
                              ? "Unblock the next step."
                              : "Make the learning visible."}
                          </h2>
                          {scoped
                            .filter((t) => t.status === "blocked")
                            .slice(0, 3)
                            .map((t) => (
                              <button
                                key={t.id}
                                onClick={() => open(t)}
                                className="blocker-link"
                              >
                                <strong>{t.title}</strong>
                                <p>
                                  {t.blocker ||
                                    "No blocker detail recorded yet."}
                                </p>
                                <small>
                                  {t.owner}
                                  <ArrowRight size={15} />
                                </small>
                              </button>
                            ))}
                          {!scoped.some((t) => t.status === "blocked") && (
                            <>
                              <p>
                                Finish a task with a short outcome and a lesson.
                                Your team can build on the evidence.
                              </p>
                              <button
                                className="text-sm font-semibold inline-flex gap-2 mt-5"
                                onClick={() => go("review")}
                              >
                                Open weekly review
                                <ArrowRight size={16} />
                              </button>
                            </>
                          )}
                        </aside>
                      </div>
                      <div className="work-section-heading mt-9">
                        <h2>Recently updated</h2>
                        <span className="text-xs text-mutedForeground">
                          Task updates, not a productivity ranking
                        </span>
                      </div>
                      {scoped.length ? (
                        <TaskRows tasks={scoped.slice(0, 5)} onOpen={open} />
                      ) : (
                        <p className="text-mutedForeground text-sm py-6">
                          Your recent work will appear here.
                        </p>
                      )}
                      {!data.teams.length && (
                        <div className="team-callout">
                          <Users size={26} />
                          <div>
                            <h3>Better together.</h3>
                            <p>
                              Create a team, invite colleagues, and review
                              shared outcomes.
                            </p>
                          </div>
                          <Button
                            variant="secondary"
                            onClick={() => go("team")}
                          >
                            Create a team
                            <ArrowUpRight size={15} />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                  {page === "tasks" && (
                    <>
                      <div className="flex flex-wrap gap-3 justify-between mb-5">
                        <label className="work-search">
                          <Search size={16} />
                          <input
                            aria-label="Search tasks"
                            placeholder="Search task, owner, or lesson…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </label>
                        <select
                          className="select-control"
                          aria-label="Task status"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">All outcomes</option>
                          {Object.entries(statusLabel).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </div>
                      <TaskRows
                        tasks={scoped.filter(
                          (t) =>
                            (filter === "all" || t.status === filter) &&
                            `${t.title} ${t.owner} ${t.lesson}`
                              .toLowerCase()
                              .includes(search.toLowerCase()),
                        )}
                        onOpen={open}
                      />
                      {!scoped.length && (
                        <Blank title="Your task history starts here">
                          Create a task or import a review pack from your local
                          installation.
                        </Blank>
                      )}
                    </>
                  )}
                  {page === "team" && (
                    <TeamPanel
                      teams={data.teams}
                      tasks={data.tasks}
                      user={user}
                      mutate={mutate}
                      notify={setNotice}
                    />
                  )}
                  {page === "compare" && (
                    <Comparison tasks={scoped} onOpen={open} />
                  )}
                  {page === "playbooks" && (
                    <>
                      <div className="flex justify-end mb-5">
                        <Button onClick={() => setPlaybook({})}>
                          <Plus size={16} />
                          New playbook
                        </Button>
                      </div>
                      <div className="playbook-grid">
                        {data.workflows.map((w) => (
                          <button
                            key={w.id}
                            className="playbook-entry"
                            onClick={() => setPlaybook(w)}
                          >
                            <BookOpen size={21} />
                            <h2>{w.title}</h2>
                            <p>
                              {w.situation ||
                                "A reusable approach backed by your work."}
                            </p>
                            <small>
                              {w.taskIds.length} evidence tasks{" "}
                              <ArrowUpRight size={16} />
                            </small>
                          </button>
                        ))}
                      </div>
                      {!data.workflows.length && (
                        <Blank title="Keep what worked">
                          Document an approach, how to validate it, and when it
                          should not be used.
                        </Blank>
                      )}
                    </>
                  )}
                  {page === "review" && (
                    <WeeklyReview
                      tasks={scoped}
                      reviews={data.reviews}
                      onOpen={open}
                      mutate={mutate}
                    />
                  )}
                  {page === "exchange" && (
                    <PackPanel
                      tasks={data.tasks.filter((t) => t.owner_id === user.id)}
                      teams={data.teams}
                      mutate={mutate}
                      notify={setNotice}
                    />
                  )}
                  {page === "specmesh" && (
                    <Suspense
                      fallback={
                        <Blank title="Opening SpecMesh">
                          Loading the coordination workspace.
                        </Blank>
                      }
                    >
                      <SpecMesh user={user} teams={data.teams} />
                    </Suspense>
                  )}
                  {page === "usage" &&
                    (user.collector ? (
                      <Suspense
                        fallback={
                          <Blank title="Opening usage reports">
                            Loading the reporting tools.
                          </Blank>
                        }
                      >
                        <Usage />
                      </Suspense>
                    ) : (
                      <Blank title="Your sessions stay on your computer">
                        Use Review packs to contribute selected metrics and task
                        outcomes.
                      </Blank>
                    ))}
                </motion.div>
              </>
            )}
          </main>
        </div>
        <AnimatePresence>
          {mobile && (
            <Sheet
              title="Workspace"
              side="left"
              onClose={() => setMobile(false)}
            >
              {links}
              <Button
                className="mt-6"
                onClick={() => onLogout().catch((e) => setError(e.message))}
              >
                <LogOut size={16} /> Sign out
              </Button>
            </Sheet>
          )}
          {editor && (
            <TaskEditor
              key={editor.id || "new"}
              task={editor}
              user={user}
              teams={data.teams}
              editable={!editor.id || canEdit(editor)}
              onClose={() => setEditor(null)}
              onSave={async (b) => {
                await mutate(
                  "/api/workspace/tasks" + (editor.id ? "/" + editor.id : ""),
                  b,
                  editor.id ? "PUT" : "POST",
                );
                setEditor(null);
                setNotice("Task saved.");
              }}
            />
          )}
          {playbook && (
            <PlaybookEditor
              key={playbook.id || "new"}
              value={playbook}
              user={user}
              tasks={data.tasks}
              teams={data.teams}
              editable={
                !playbook.id ||
                playbook.owner_id === user.id ||
                data.teams.some(
                  (t) => t.id === playbook.team_id && t.role === "lead",
                )
              }
              onClose={() => setPlaybook(null)}
              onSave={async (b) => {
                await mutate(
                  "/api/workspace/workflows" +
                    (playbook.id ? "/" + playbook.id : ""),
                  b,
                  playbook.id ? "PUT" : "POST",
                );
                setPlaybook(null);
                setNotice("Playbook saved.");
              }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {notice && (
            <motion.div
              role="status"
              className="workspace-toast"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={15} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
