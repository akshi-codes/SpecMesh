import { useState } from "react";
import { ArrowUpRight, ArrowDownRight, ChevronRight } from "lucide-react";
import { Card, CardHeader, Button } from "../components/ui.jsx";
import {
  TokenAreaChart,
  ModelPieChart,
  ProjectBarChart,
} from "../components/Charts.jsx";
import { BudgetProgress } from "../components/BudgetProgress.jsx";
import { BudgetPeriodToggle } from "../components/BudgetPeriodToggle.jsx";
import { formatCompact } from "../lib/api.js";
export function Overview({
  overview,
  summary,
  budgets,
  ingest,
  onOpenThread,
  onOpenProject,
  onFilter,
}) {
  const [budgetPeriod, setBudgetPeriod] = useState("weekly");
  const t = overview.totals,
    c = summary.comparison;
  const delta = c.delta > 0 ? "+" : "";
  return (
    <div className="space-y-6">
      <section className="usage-heading">
        <div>
          <p className="text-sm text-mutedForeground">Total token volume</p>
          <p
            className="my-2 text-5xl font-semibold tracking-[-0.06em] sm:text-6xl"
            title={t.total_tokens.toLocaleString()}
          >
            {formatCompact(t.total_tokens)}
          </p>
          <p className="text-sm text-mutedForeground">
            Across {t.turns.toLocaleString()} usage events in{" "}
            {t.threads.toLocaleString()} threads
          </p>
        </div>
        <div className="comparison-callout">
          <span className="text-xs font-medium text-mutedForeground">
            Compared with the previous equivalent period
          </span>
          <p className="mt-2 flex items-center gap-2 text-2xl font-semibold">
            {c.delta >= 0 ? (
              <ArrowUpRight size={22} />
            ) : (
              <ArrowDownRight size={22} />
            )}{" "}
            {c.available
              ? c.percent === null
                ? c.current
                  ? "New activity"
                  : "No change"
                : `${delta}${c.percent.toFixed(1)}%`
              : "All recorded time"}
          </p>
          <p className="mt-1 text-xs text-mutedForeground">
            {c.available
              ? `${delta}${c.delta.toLocaleString()} tokens; previous total ${c.previous.toLocaleString()}`
              : "Choose a shorter period to compare usage."}
          </p>
        </div>
      </section>
      <div className="metric-strip">
        <Metric
          label="Tokens today"
          value={formatCompact(summary.today.total_tokens)}
          note="In the reporting timezone"
        />
        <Metric
          label="Cache reuse"
          value={`${summary.ratios.cacheRatio.toFixed(1)}%`}
          note="Cached input / all input"
        />
        <Metric
          label="Observed tool failures"
          value={
            summary.efficiency.errorRate === null
              ? "Not available"
              : `${summary.efficiency.errorRate.toFixed(1)}%`
          }
          note={`${t.error_events} explicit failures / ${t.tool_events} observed calls`}
        />
        <Metric
          label="Average usage event"
          value={formatCompact(t.turns ? t.total_tokens / t.turns : 0)}
          note="An event is not always a user turn"
        />
      </div>
      <div className="grid gap-5">
        <Card>
          <CardHeader
            title="Usage over time"
            description="Select a day to inspect its activity."
          />
          <div className="p-4">
            <TokenAreaChart
              data={overview.daily}
              onSelect={(day) =>
                onFilter({ range: "custom", from: day, to: day })
              }
            />
            <div className="flex flex-wrap gap-1" aria-label="Inspect a day">
              {overview.daily.slice(-7).map((d) => (
                <button
                  key={d.day}
                  className="filter-chip"
                  onClick={() =>
                    onFilter({ range: "custom", from: d.day, to: d.day })
                  }
                >
                  {d.day}
                </button>
              ))}
            </div>
          </div>
        </Card>

      </div>
      <div className="grid gap-5">

        <Card>
          <CardHeader
            title="Largest usage events"
            description="Open a thread to see the full timeline."
          />
          <div className="divide-y divide-border">
            {overview.anomalies.length ? (
              overview.anomalies.map((r) => (
                <button
                  className="insight-row"
                  key={r.id}
                  onClick={() => onOpenThread(r.thread_id)}
                >
                  <span>
                    <strong>{r.project}</strong>
                    <small>{new Date(r.occurred_at).toLocaleString()}</small>
                  </span>
                  <span className="font-mono text-sm">
                    {formatCompact(r.tokens)}{" "}
                    <ChevronRight className="inline" size={15} />
                  </span>
                </button>
              ))
            ) : (
              <p className="p-6 text-sm text-mutedForeground">
                Sync local sessions to see usage events.
              </p>
            )}
          </div>
        </Card>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Projects"
            description="Select a project to filter the report."
          />
          <div className="p-4">
            <ProjectBarChart
              data={overview.byProject}
              onSelect={onOpenProject}
            />
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Model mix"
            description="Select a model to filter the report."
          />
          <div className="p-4">
            <ModelPieChart
              data={overview.byModel}
              onSelect={(model) => onFilter({ model })}
            />
            <div className="flex flex-wrap gap-2">
              {overview.byModel.map((m) => (
                <button
                  className="filter-chip"
                  key={m.model}
                  onClick={() => onFilter({ model: m.model })}
                >
                  {m.model}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Budget pace"
            description="Personal tracking limits across all projects."
            action={
              <BudgetPeriodToggle
                value={budgetPeriod}
                onChange={setBudgetPeriod}
              />
            }
          />
          <div className="space-y-3 p-5">
            <BudgetProgress
              label={
                budgetPeriod === "weekly" ? "Rolling 7 days" : "Rolling 30 days"
              }
              budget={budgets.global[budgetPeriod]}
            />
            <p className="text-xs leading-5 text-mutedForeground">
              Next-day estimate:{" "}
              {formatCompact(budgets.global[budgetPeriod].projected)} tokens.
              Includes {formatCompact(budgets.global[budgetPeriod].expiring)}{" "}
              tokens aging out, and assumes your recent average continues. This
              does not enforce a Codex limit.
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Import health"
            description={ingest.last?.message || "Ready for your first scan."}
          />
          <div className="grid grid-cols-2 gap-4 p-5">
            <Metric
              label="Last scan"
              value={ingest.last?.status || "Not started"}
              note={`${ingest.last?.files_scanned || 0} scanned; ${ingest.last?.files_skipped || 0} unchanged`}
            />
            <Metric
              label="Needs attention"
              value={String(
                (ingest.last?.files_failed || 0) +
                  (ingest.last?.invalid_lines || 0),
              )}
              note={`${ingest.last?.files_failed || 0} unreadable files; ${ingest.last?.invalid_lines || 0} invalid records`}
            />
          </div>
        </Card>
      </div>
      {summary.costs.enabled && (
        <Card>
          <CardHeader
            title={summary.costs.label}
            description="Using your dated rates. This is not a subscription bill or remaining allowance."
          />
          <div className="p-5">
            <p className="text-3xl font-semibold">
              ${summary.costs.usd.toFixed(4)}
            </p>
            <p className="mt-2 text-sm text-mutedForeground">
              {summary.costs.covered} priced events; {summary.costs.unpriced}{" "}
              events have no applicable rate.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
function Metric({ label, value, note }) {
  return (
    <div>
      <p className="text-xs text-mutedForeground">{label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-mutedForeground">{note}</p>
    </div>
  );
}
function Contribution({ rows, onSelect, label }) {
  return (
    <div className="mb-5 last:mb-0">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-mutedForeground">
        {label}
      </p>
      {rows.slice(0, 4).map((r) => (
        <button
          key={r.id}
          className="flex w-full items-center justify-between gap-4 rounded-md py-2 text-left text-sm hover:bg-muted"
          onClick={() => onSelect(r.id)}
        >
          <span className="truncate">{r.name}</span>
          <span className="shrink-0 font-mono">
            {r.delta > 0 ? "+" : ""}
            {formatCompact(r.delta)}
          </span>
        </button>
      ))}
      {!rows.length && (
        <p className="text-sm text-mutedForeground">
          No activity in either period.
        </p>
      )}
    </div>
  );
}
