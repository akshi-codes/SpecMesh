import { Button } from "../components/ui.jsx";
import { DateControls } from "../components/DateControls.jsx";
import { NotificationCenter } from "../components/NotificationCenter.jsx";
export function UsageShell({
  active,
  setActive,
  query,
  queryString,
  onFilter,
  toast,
  onIngest,
  ingest,
  notifications,
  onDismissAlert,
  onSnooze,
  children,
  settings,
  onLive,
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5 mb-6">
        <nav aria-label="Usage sections" className="flex flex-wrap gap-1">
          {["overview", "projects", "threads", "settings"].map((id) => (
            <Button
              key={id}
              variant={active === id ? "primary" : "ghost"}
              size="sm"
              onClick={() => setActive(id)}
            >
              {id === "overview"
                ? "Usage report"
                : id === "settings"
                  ? "Data settings"
                  : id[0].toUpperCase() + id.slice(1)}
            </Button>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <DateControls
            query={query}
            queryString={queryString}
            onChange={onFilter}
            toast={toast}
          />
          <NotificationCenter
            notifications={notifications}
            onDismiss={onDismissAlert}
            onSnooze={onSnooze}
          />
          <Button
            size="sm"
            onClick={onIngest}
            disabled={ingest?.current?.status === "running"}
          >
            {ingest?.current?.status === "running" ? "Syncing…" : "Sync now"}
          </Button>
          <button
            className="filter-chip"
            role="switch"
            aria-checked={!!settings?.live}
            onClick={() => onLive(!settings?.live)}
          >
            Live {settings?.live ? "on" : "off"}
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
