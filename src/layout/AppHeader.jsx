import {
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Sun,
  Radio,
} from "lucide-react";
import { Button } from "../components/ui.jsx";
import { NotificationCenter } from "../components/NotificationCenter.jsx";
import { DateControls } from "../components/DateControls.jsx";
const titles = {
  overview: ["Your usage, in perspective", "Overview"],
  projects: ["Organize your workspaces", "Projects"],
  threads: ["Follow the details", "Threads"],
  settings: ["Make it yours", "Settings"],
};
export function AppHeader({
  active,
  query,
  queryString,
  onFilter,
  toast,
  theme,
  setTheme,
  sidebarCollapsed,
  setSidebarCollapsed,
  setMobileOpen,
  ingest,
  onIngest,
  notifications,
  settings,
  onLive,
  onDismissAlert,
  onSnooze,
}) {
  const running = ingest?.current?.status === "running",
    last = ingest?.last?.finished_at;
  const stale =
    !last ||
    Date.now() - Date.parse(last) >
      (settings?.live ? Math.max(90, settings.syncSeconds * 3) : 86400) * 1000;
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1560px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            aria-label={
              sidebarCollapsed ? "Expand navigation" : "Collapse navigation"
            }
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </Button>
          <div>
            <p className="text-xs text-mutedForeground">
              {titles[active]?.[0]}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {titles[active]?.[1]}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateControls
            query={query}
            onChange={onFilter}
            queryString={queryString}
            toast={toast}
          />
          <NotificationCenter
            notifications={notifications}
            onDismiss={onDismissAlert}
            onSnooze={onSnooze}
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label={
              theme === "dark"
                ? "Switch to light theme"
                : "Switch to dark theme"
            }
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </Button>
          <Button variant="primary" onClick={onIngest} disabled={running}>
            <RefreshCw size={15} className={running ? "animate-spin" : ""} />
            {running ? "Syncing" : "Sync now"}
          </Button>
        </div>
      </div>
      <div className="mx-auto flex max-w-[1560px] flex-wrap items-center justify-between gap-2 px-5 pb-3 text-xs sm:px-7 lg:px-10">
        <button
          type="button"
          role="switch"
          aria-checked={!!settings?.live}
          onClick={() => onLive(!settings?.live)}
          className="inline-flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Radio
            size={14}
            className={settings?.live ? "text-accent" : "text-mutedForeground"}
          />
          <span>{settings?.live ? "Live updates on" : "Live updates off"}</span>
          <span className={`switch-track ${settings?.live ? "is-on" : ""}`}>
            <span />
          </span>
        </button>
        <span className={stale ? "text-warning" : "text-mutedForeground"}>
          {running
            ? "Reading local session changes…"
            : last
              ? `${stale ? "Data may be stale. " : ""}Last sync ${new Date(last).toLocaleTimeString()}`
              : "No sync yet. Open Settings to check your data source."}
        </span>
      </div>
    </header>
  );
}
