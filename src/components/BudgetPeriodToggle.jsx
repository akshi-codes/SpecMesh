import { clsx } from "../lib/clsx.js";
import { motion } from "motion/react";

const PERIODS = [
  { id: "weekly", label: "7 days" },
  { id: "monthly", label: "30 days" },
];

export function BudgetPeriodToggle({ value, onChange, compact = false }) {
  return (
    <div
      className="relative inline-flex rounded-md border border-border bg-card/80 p-px shadow-sm"
      role="group"
      aria-label="Budget period"
    >
      {PERIODS.map((period) => (
        <button
          key={period.id}
          type="button"
          aria-pressed={value === period.id}
          onClick={() => onChange(period.id)}
          className={clsx(
            "relative z-10 rounded font-bold normal-case leading-none transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
            compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
            value === period.id
              ? "text-white dark:text-slate-950"
              : "text-mutedForeground hover:bg-muted hover:text-foreground",
          )}
        >
          {value === period.id ? (
            <motion.div
              layoutId="budget-pill"
              className="absolute inset-0 -z-10 rounded bg-accent shadow-sm"
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          ) : null}
          {period.label}
        </button>
      ))}
    </div>
  );
}
