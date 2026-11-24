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
  motion,
  MotionConfig,
  useReducedMotion,
} from "motion/react";
import { UsageShell as AppShell } from "./layout/UsageShell.jsx";
import { Button, EmptyState } from "./components/ui.jsx";
import { ToastViewport } from "./components/ToastViewport.jsx";
import { useStoredState } from "./hooks/useStoredState.js";
import { api } from "./lib/api.js";
import { applyTheme } from "./lib/theme.js";
const Overview = lazy(() =>
  import("./views/Overview.jsx").then((m) => ({ default: m.Overview })),
);
const Projects = lazy(() =>
  import("./views/Projects.jsx").then((m) => ({ default: m.Projects })),
);
const Threads = lazy(() =>
  import("./views/Threads.jsx").then((m) => ({ default: m.Threads })),
);
const SettingsView = lazy(() =>
  import("./views/SettingsView.jsx").then((m) => ({ default: m.SettingsView })),
);
const ThreadExplorer = lazy(() =>
  import("./views/ThreadExplorer.jsx").then((m) => ({
    default: m.ThreadExplorer,
  })),
);

function readRoute() {
  const p = new URLSearchParams(location.search);
  return {
    active: ["overview", "projects", "threads", "settings"].includes(
      p.get("view"),
    )
      ? p.get("view")
      : "overview",
    query: {
      range: p.get("range") || "30d",
      timezone:
        p.get("timezone") || Intl.DateTimeFormat().resolvedOptions().timeZone,
      from: p.get("from") || "",
      to: p.get("to") || "",
      projectId: p.get("projectId") || "",
      model: p.get("model") || "",
      group: p.get("group") || "",
    },
    threadId: p.get("thread") || "",
  };
}
export default function App() {
  const [route, setRoute] = useState(readRoute),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ingesting, setIngesting] = useState(false),
    [toasts, setToasts] = useState([]),
    [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useStoredState("token-monitor-theme", "light"),
    [collapsed, setCollapsed] = useStoredState("token-monitor-sidebar", false);
  const controller = useRef(),
    timers = useRef(new Set()),
    reduce = useReducedMotion();
  const { active, query, threadId } = route;
  const routeRef = useRef(route);
  routeRef.current = route;
  const queryString = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== ""),
  ).toString();
  const navigate = useCallback((patch) => {
    const old = routeRef.current;
    const next = {
      ...old,
      ...patch,
      query: { ...old.query, ...patch.query },
    };
    const p = new URLSearchParams({ ...next.query, view: next.active });
    if (next.threadId) p.set("thread", next.threadId);
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    history.pushState(null, "", `?${p}`);
    routeRef.current = next;
    setRoute(next);
  }, []);
  useEffect(() => {
    const fn = () => setRoute(readRoute());
    window.addEventListener("popstate", fn);
    return () => window.removeEventListener("popstate", fn);
  }, []);
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    // Warm small route chunks after initial rendering, before the first tab click.
    const timer = setTimeout(() => {
      void Promise.allSettled([
        import("./views/Projects.jsx"),
        import("./views/Threads.jsx"),
        import("./views/SettingsView.jsx"),
        import("./views/ThreadExplorer.jsx"),
      ]);
    }, 500);
    return () => clearTimeout(timer);
  }, []);
  const toast = useCallback((message, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    const timer = setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
      timers.current.delete(timer);
    }, 5000);
    timers.current.add(timer);
  }, []);
  useEffect(
    () => () => {
      controller.current?.abort();
      for (const t of timers.current) clearTimeout(t);
    },
    [],
  );
  const load = useCallback(
    async (quiet = false) => {
      controller.current?.abort();
      const ctrl = new AbortController();
      controller.current = ctrl;
      if (!quiet) setBusy(true);
      try {
        const paths = [
          `/api/overview?${queryString}`,
          `/api/usage-summary?${queryString}`,
          `/api/projects?${queryString}`,
          `/api/threads?${queryString}`,
          "/api/settings",
          "/api/ingest/status",
          "/api/budgets",
          "/api/alerts",
          "/api/annotations",
        ];
        const [
          overview,
          summary,
          projects,
          threads,
          settings,
          ingest,
          budgets,
          alerts,
          annotations,
        ] = await Promise.all(
          paths.map((p) => api(p, { signal: ctrl.signal })),
        );
        if (ctrl.signal.aborted) return;
        setData({
          queryString,
          overview,
          summary,
          projects,
          threads,
          settings,
          ingest,
          budgets,
          alerts,
          annotations,
        });
        setError("");
      } catch (e) {
        if (!ctrl.signal.aborted && !e.cancelled) setError(e.message);
      } finally {
        if (!ctrl.signal.aborted) setBusy(false);
      }
    },
    [queryString],
  );
  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!data?.settings.live) return;
    const timer = setInterval(() => {
      if (!document.hidden && !busy) void load(true);
    }, 5000);
    return () => clearInterval(timer);
  }, [data?.settings.live, busy, load]);
  const mutate = async (path, body, method = "PUT") => {
    try {
      const result = await api(path, { method, body: JSON.stringify(body) });
      if (path === "/api/settings") {
        controller.current?.abort();
        setBusy(false);
        setData(
          (old) => old && { ...old, settings: { ...old.settings, ...result } },
        );
      } else if (path.startsWith("/api/alerts/")) {
        controller.current?.abort();
        setBusy(false);
        const id = decodeURIComponent(path.split("/").at(-1));
        setData(
          (old) =>
            old && {
              ...old,
              alerts: old.alerts.map((a) =>
                a.id === id ? { ...a, dismissed: true } : a,
              ),
            },
        );
      }
      void loadRef.current(true);
      return result;
    } catch (e) {
      toast(e.message, "error");
      throw e;
    }
  };
  const sync = async (force = false) => {
    setIngesting(true);
    try {
      const result = await mutate("/api/ingest/run", { force }, "POST");
      toast(
        result.message,
        result.status === "failed" || result.status === "partial"
          ? "error"
          : "success",
      );
    } catch {
    } finally {
      setIngesting(false);
    }
  };
  const openThread = (id) => navigate({ threadId: id });
  const openProject = (id) =>
    navigate({ active: "threads", query: { projectId: id } });
  const notifications = (data?.alerts || [])
    .filter((a) => !a.dismissed)
    .map((a) => ({
      id: a.id,
      message: a.message,
      type: "warning",
      createdAt: Date.parse(a.created_at),
    }));
  const saveAnnotation = async (kind, id, value) => {
    await mutate(`/api/annotations/${kind}/${encodeURIComponent(id)}`, value);
    toast("Organization saved.");
  };
  const props = {
    ...data,
    query,
    queryString,
    range: query.range,
    onOpenThread: openThread,
    onOpenProject: openProject,
    onFilter: (patch) => navigate({ query: patch }),
    onSaveAnnotation: saveAnnotation,
    toast,
  };
  return (
    <MotionConfig reducedMotion="user">
      <AppShell
        active={active}
        setActive={(id) => navigate({ active: id })}
        range={query.range}
        setRange={(range) => navigate({ query: { range } })}
        query={query}
        queryString={queryString}
        onFilter={(patch) => navigate({ query: patch })}
        toast={toast}
        settings={data?.settings}
        onLive={(live) => mutate("/api/settings", { live }).catch(() => {})}
        theme={theme}
        setTheme={setTheme}
        sidebarCollapsed={collapsed}
        setSidebarCollapsed={setCollapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        ingest={
          ingesting
            ? { ...data?.ingest, current: { status: "running" } }
            : data?.ingest
        }
        loading={busy}
        onIngest={() => sync()}
        notifications={notifications}
        onDismissAlert={(id) =>
          mutate(`/api/alerts/${encodeURIComponent(id)}`, {}).catch(() => {})
        }
        onSnooze={() =>
          mutate("/api/settings", {
            snoozedUntil: new Date(Date.now() + 3600000).toISOString(),
          })
            .then(() => toast("Budget alerts snoozed for one hour."))
            .catch(() => {})
        }
      >
        {error && (
          <div
            role="alert"
            className="mb-4 flex items-center justify-between rounded-lg border border-danger/30 p-3 text-sm"
          >
            {error}
            <Button variant="ghost" size="sm" onClick={() => load()}>
              Retry
            </Button>
          </div>
        )}
        {!data || data.queryString !== queryString ? (
          <EmptyState
            title={
              error ? "Unable to load your local data" : "Loading local usage"
            }
          >
            Your metrics stay on this computer.
          </EmptyState>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-mutedForeground">
              <span>
                {new Date(data.overview.window.start).toLocaleDateString(
                  undefined,
                  { timeZone: data.overview.window.timezone },
                )}{" "}
                to{" "}
                {new Date(
                  Date.parse(data.overview.window.end) - 1,
                ).toLocaleDateString(undefined, {
                  timeZone: data.overview.window.timezone,
                })}
              </span>
              <span className="border-l border-border pl-2">
                {query.timezone}
              </span>
              {["projectId", "model", "group"]
                .filter((k) => query[k])
                .map((k) => (
                  <button
                    key={k}
                    className="filter-chip"
                    onClick={() => navigate({ query: { [k]: "" } })}
                  >
                    {k === "projectId"
                      ? data.projects.find((p) => p.id === query[k])?.name ||
                        "Selected project"
                      : query[k]}{" "}
                    ×
                  </button>
                ))}
            </div>
            <Suspense
              fallback={
                <div
                  className="skeleton h-64 rounded-xl"
                  aria-label="Loading view"
                />
              }
            >
              <motion.div
                key={active}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduce ? 0 : 0.14 }}
              >
                {active === "overview" ? (
                  <Overview {...props} />
                ) : active === "projects" ? (
                  <Projects {...props} />
                ) : active === "threads" ? (
                  <Threads {...props} />
                ) : (
                  <SettingsView
                    {...props}
                    onSaveBudget={(b) =>
                      mutate("/api/budgets", b).then(() =>
                        toast("Budget saved."),
                      )
                    }
                    onForceIngest={() => sync(true)}
                    onMutate={mutate}
                  />
                )}
              </motion.div>
            </Suspense>
          </>
        )}
      </AppShell>
      <Suspense fallback={null}>
        <AnimatePresence>
          {threadId && (
            <ThreadExplorer
              key={threadId}
              id={threadId}
              queryString={queryString}
              revision={data?.summary.generatedAt}
              onClose={() => navigate({ threadId: "" })}
              onSave={(value) => saveAnnotation("thread", threadId, value)}
            />
          )}
        </AnimatePresence>
      </Suspense>
      <ToastViewport
        toasts={toasts}
        dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))}
      />
    </MotionConfig>
  );
}
