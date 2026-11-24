import { Sidebar } from "./Sidebar.jsx";
import { AppHeader } from "./AppHeader.jsx";
import { clsx } from "../lib/clsx.js";
import { motion } from "motion/react";

export function AppShell({
  active,
  setActive,
  range,
  setRange,
  theme,
  setTheme,
  sidebarCollapsed,
  setSidebarCollapsed,
  mobileOpen,
  setMobileOpen,
  ingest,
  loading,
  onIngest,
  notifications,
  children,
  ...extras
}) {
  const sidebarWidth = sidebarCollapsed ? "lg:pl-24" : "lg:pl-72";

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <a className="skip-link" href="#main-content">
        Skip to dashboard content
      </a>
      {loading ? <div className="top-loader" /> : null}
      <Sidebar
        active={active}
        setActive={setActive}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />

      <motion.div
        layout
        className={clsx("min-h-[100dvh]", sidebarWidth)}
        transition={{ duration: 0.22 }}
      >
        <AppHeader
          {...extras}
          active={active}
          range={range}
          setRange={setRange}
          theme={theme}
          setTheme={setTheme}
          sidebarCollapsed={sidebarCollapsed}
          setSidebarCollapsed={setSidebarCollapsed}
          setMobileOpen={setMobileOpen}
          ingest={ingest}
          onIngest={onIngest}
          notifications={notifications}
        />
        <main
          id="main-content"
          tabIndex="-1"
          className="mx-auto w-full max-w-[1560px] px-4 pb-12 pt-5 outline-none sm:px-6 lg:px-8 lg:pt-7"
        >
          {children}
        </main>
      </motion.div>
    </div>
  );
}
