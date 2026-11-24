import { formatCompact } from "../lib/api.js";

export function UsageBrief({ summary }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="relative p-5 sm:p-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgb(var(--accent-soft))_0,transparent_34%),linear-gradient(135deg,rgb(var(--card))_0%,rgb(var(--muted))_100%)] opacity-80" />
        <div className="relative space-y-5">
          <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MiniMetric label="Peak day" value={summary?.peakDay?.day || "n/a"} detail={formatCompact(summary?.peakDay?.tokens)} />
            <MiniMetric label="Biggest project" value={summary?.biggestProject?.name || "n/a"} detail={formatCompact(summary?.biggestProject?.tokens)} />
            <MiniMetric label="7-day burn" value={formatCompact(summary?.last7?.total_tokens)} detail={`${formatCompact(Math.round((summary?.last7?.total_tokens || 0) / 7))}/day`} />
            <MiniMetric label="Output + reasoning" value={`${Math.round((summary?.ratios?.outputRatio || 0) + (summary?.ratios?.reasoningRatio || 0))}%`} detail="of selected range" />
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniMetric({ label, value, detail }) {
  return (
    <div className="group rounded-lg border border-border/80 bg-card/70 p-3 shadow-sm backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow-sm">
      <p className="text-xs font-semibold uppercase text-mutedForeground">{label}</p>
      <p className="mt-1 truncate text-base font-semibold text-foreground">{value}</p>
      <p className="text-xs text-mutedForeground">{detail}</p>
    </div>
  );
}