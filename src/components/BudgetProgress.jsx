import { clsx } from "../lib/clsx.js";
import { formatCompact } from "../lib/api.js";

export function BudgetProgress({ label, budget, compact = false }) {
  const limit = Number(budget?.limit || 0);
  const used = Number(budget?.used || 0);
  const percent = limit ? (used / limit) * 100 : 0;
  const tone =
    percent >= 100 ? "bg-danger" : percent >= 80 ? "bg-warning" : "bg-accent";

  return (
    <div className={clsx("space-y-2", compact && "min-w-36")}>
      <div className="flex items-center justify-between gap-3 text-xs font-bold">
        <span className="text-mutedForeground">{label}</span>
        <span className="flex items-baseline gap-2 text-foreground">
          <span>
            {limit
              ? `${formatCompact(used)} / ${formatCompact(limit)}`
              : "Not set"}
          </span>
          {limit ? (
            <span className="text-[11px] font-semibold text-mutedForeground">
              {Math.round(percent)}% used
            </span>
          ) : null}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${label} budget usage`}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.min(100, Math.round(percent))}
        aria-valuetext={`${Math.round(percent)}% of budget used`}
      >
        <div
          className={clsx(
            "h-full origin-left rounded-full transition-transform duration-300 ease-out",
            tone,
          )}
          style={{ transform: `scaleX(${Math.min(100, percent) / 100})` }}
        />
      </div>
    </div>
  );
}
