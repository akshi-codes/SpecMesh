import { LockKeyhole, Radar } from "lucide-react";
import { navItems } from "../constants/navigation.jsx";
import { Sheet } from "../components/Interactions.jsx";
import { clsx } from "../lib/clsx.js";
import { AnimatePresence, motion } from "motion/react";

export function Sidebar({
  active,
  setActive,
  collapsed,
  mobileOpen,
  setMobileOpen,
}) {
  return (
    <>
      <motion.aside
        layout
        transition={{ duration: 0.22 }}
        className={clsx(
          "fixed inset-y-0 left-0 z-20 hidden border-r border-border/80 bg-card px-3 py-4 lg:block",
          collapsed ? "w-24" : "w-72",
        )}
      >
        <SidebarContent
          active={active}
          setActive={setActive}
          collapsed={collapsed}
        />
      </motion.aside>
      <AnimatePresence>
        {mobileOpen ? (
          <Sheet
            title="Navigation"
            side="left"
            onClose={() => setMobileOpen(false)}
          >
            <SidebarContent
              active={active}
              setActive={(id) => {
                setActive(id);
                setMobileOpen(false);
              }}
              collapsed={false}
            />
          </Sheet>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function SidebarContent({ active, setActive, collapsed }) {
  return (
    <div className="flex h-full flex-col">
      <div
        className={clsx(
          "flex items-center gap-3 px-2",
          collapsed && "justify-center",
        )}
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primaryForeground shadow-[0_10px_24px_rgb(35_61_50/0.18)]">
          <Radar size={21} strokeWidth={1.8} />
        </div>
        {!collapsed ? (
          <motion.div
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.18 }}
            className="min-w-0"
          >
            <p className="text-[0.68rem] font-semibold tracking-[0.18em] text-accent">
              Local analytics
            </p>
            <h1 className="truncate text-lg font-semibold tracking-[-0.025em]">
              Token monitor
            </h1>
          </motion.div>
        ) : null}
      </div>

      <nav className="mt-10 space-y-1.5" aria-label="Primary navigation">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActive(item.id)}
            title={collapsed ? item.label : undefined}
            aria-current={active === item.id ? "page" : undefined}
            className={clsx(
              "group relative flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-accent/50",
              active === item.id
                ? "bg-primary text-primaryForeground"
                : "text-mutedForeground hover:bg-muted hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            {active === item.id ? (
              <motion.span
                layoutId="active-rail"
                className="absolute -left-3 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-accent"
                transition={{ type: "spring", stiffness: 500, damping: 34 }}
              />
            ) : null}
            <item.icon size={18} strokeWidth={1.8} className="shrink-0" />
            {!collapsed ? (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.18 }}
              >
                {item.label}
              </motion.span>
            ) : null}
          </button>
        ))}
      </nav>

      <div
        className={clsx(
          "mt-auto rounded-2xl bg-muted/70 p-3",
          collapsed && "flex justify-center bg-transparent px-0",
        )}
      >
        <LockKeyhole size={17} className="shrink-0 text-accent" />
        {!collapsed ? (
          <div className="mt-3">
            <p className="text-sm font-semibold text-foreground">
              Metrics only
            </p>
            <p className="mt-1 text-xs leading-5 text-mutedForeground">
              Prompt content stays out of the local monitor.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
