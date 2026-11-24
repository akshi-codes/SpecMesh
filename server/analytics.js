import { allRows, getDb } from "./db.js";
import { tokenTotal } from "./util.js";
import { period, dayKey } from "./periods.js";
import { preferences } from "./preferences.js";
let usageCache;

export function usageRows() {
  const db = getDb();
  const changes = db.prepare("SELECT total_changes() AS n").get().n;
  const version = db.prepare("PRAGMA data_version").get().data_version;
  if (
    usageCache?.db === db &&
    usageCache.changes === changes &&
    usageCache.version === version
  )
    return usageCache.rows;
  // Historical sessions take precedence for a conversation, avoiding cross-source double counting.
  const rows =
    allRows(`SELECT t.*,p.name AS project_name,p.path AS project_path,th.title,
    coalesce(pa.label,'') AS project_alias,coalesce(pa.group_name,'') AS group_name,
    coalesce(a.label,'') AS label,coalesce(a.tags,'[]') AS tags,coalesce(a.bookmarked,0) AS bookmarked
    FROM turns t JOIN projects p ON p.id=t.project_id JOIN threads th ON th.id=t.thread_id
    LEFT JOIN annotations pa ON pa.kind='project' AND pa.id=p.id LEFT JOIN annotations a ON a.kind='thread' AND a.id=th.id
    WHERE t.source!='codex-otel' OR NOT EXISTS(SELECT 1 FROM turns s WHERE s.thread_id=t.thread_id AND s.source!='codex-otel')
    ORDER BY t.occurred_at`).map((r) => ({
      ...r,
      tokens: tokenTotal(r),
      total_tokens: tokenTotal(r),
      project_name: r.project_alias || r.project_name,
      title: r.label || r.title,
      tags: JSON.parse(r.tags),
      bookmarked: Boolean(r.bookmarked),
    }));
  usageCache = { db, changes, version, rows };
  return rows;
}
export const within = (rows, start, end) =>
  rows.filter((r) => r.occurred_at >= start && r.occurred_at < end);
export function selectedRows(query = {}, now = Date.now()) {
  const window = period(query, now);
  let rows = within(usageRows(), window.start, window.end);
  if (query.projectId)
    rows = rows.filter((r) => r.project_id === query.projectId);
  if (query.model)
    rows = rows.filter((r) => (r.model || "unknown") === query.model);
  if (query.group) rows = rows.filter((r) => r.group_name === query.group);
  return { rows, window };
}
export function totals(rows) {
  const result = {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    tool_events: 0,
    error_events: 0,
    total_tokens: 0,
    turns: rows.length,
    threads: new Set(rows.map((r) => r.thread_id)).size,
    projects: new Set(rows.map((r) => r.project_id)).size,
  };
  for (const r of rows)
    for (const key of [
      "input_tokens",
      "cached_input_tokens",
      "output_tokens",
      "reasoning_output_tokens",
      "tool_events",
      "error_events",
      "total_tokens",
    ])
      result[key] += Number(r[key] || 0);
  return result;
}
export function grouped(rows, key, decorate = () => ({})) {
  const groups = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups]
    .map(([id, list]) => {
      const sum = totals(list);
      return {
        id,
        ...decorate(list[0], list),
        ...sum,
        tokens: sum.total_tokens,
      };
    })
    .sort((a, b) => b.tokens - a.tokens);
}
export function overview(query) {
  const { rows, window } = selectedRows(query);
  return {
    totals: totals(rows),
    window,
    daily: grouped(
      rows,
      (r) => dayKey(r.occurred_at, window.timezone),
      (r) => ({ day: dayKey(r.occurred_at, window.timezone) }),
    ).sort((a, b) => a.day.localeCompare(b.day)),
    byProject: grouped(
      rows,
      (r) => r.project_id,
      (r) => ({ name: r.project_name }),
    ).slice(0, 10),
    byModel: grouped(
      rows,
      (r) => r.model || "unknown",
      (r) => ({ model: r.model || "unknown" }),
    ),
    anomalies: [...rows]
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        thread_id: r.thread_id,
        project: r.project_name,
        tokens: r.tokens,
        occurred_at: r.occurred_at,
      })),
  };
}
export function projectRows(query = {}) {
  const { rows } = selectedRows(query),
    budgets = budgetResponse();
  return grouped(
    rows,
    (r) => r.project_id,
    (r) => ({
      name: r.project_name,
      path: r.project_path,
      group_name: r.group_name,
    }),
  ).map((r) => ({
    ...r,
    weekly_budget:
      budgets.projects.find((b) => b.id === r.id)?.weekly.limit || 0,
    monthly_budget:
      budgets.projects.find((b) => b.id === r.id)?.monthly.limit || 0,
    last7_tokens: budgets.projects.find((b) => b.id === r.id)?.weekly.used || 0,
    last30_tokens:
      budgets.projects.find((b) => b.id === r.id)?.monthly.used || 0,
  }));
}
export function threadRows(query = {}) {
  const { rows } = selectedRows(query);
  return grouped(
    rows,
    (r) => r.thread_id,
    (r, list) => ({
      title: r.title,
      project_name: r.project_name,
      project_id: r.project_id,
      model: r.model || "unknown",
      status: "observed",
      tags: r.tags,
      bookmarked: r.bookmarked,
      last_seen: list.at(-1).occurred_at,
      models: [...new Set(list.map((x) => x.model || "unknown"))],
    }),
  ).sort((a, b) => b.last_seen.localeCompare(a.last_seen));
}
export function summary(query = {}, now = Date.now()) {
  const { rows, window } = selectedRows(query, now),
    all = usageRows();
  let previous = within(all, window.previousStart, window.previousEnd);
  if (query.projectId)
    previous = previous.filter((r) => r.project_id === query.projectId);
  if (query.model)
    previous = previous.filter((r) => (r.model || "unknown") === query.model);
  if (query.group)
    previous = previous.filter((r) => r.group_name === query.group);
  const current = totals(rows),
    before = totals(previous);
  const contributions = (key, name) => {
    const a = grouped(rows, key, name),
      b = grouped(previous, key, name);
    return [...new Set([...a, ...b].map((r) => r.id))]
      .map((id) => {
        const x = a.find((r) => r.id === id),
          y = b.find((r) => r.id === id);
        return {
          ...(x || y),
          current: x?.tokens || 0,
          previous: y?.tokens || 0,
          delta: (x?.tokens || 0) - (y?.tokens || 0),
        };
      })
      .sort((a, b) => b.delta - a.delta);
  };
  const projects = contributions(
      (r) => r.project_id,
      (r) => ({ name: r.project_name }),
    ),
    models = contributions(
      (r) => r.model || "unknown",
      (r) => ({ name: r.model || "unknown" }),
    );
  const insights = [];
  if (window.comparable && projects[0]?.delta > 0)
    insights.push({
      id: "increase",
      title: `${projects[0].name} increased the most`,
      detail: `${projects[0].delta.toLocaleString()} more tokens than the comparison period.`,
      projectId: projects[0].id,
    });
  const historyByProject = new Map();
  for (const r of previous) {
    if (!historyByProject.has(r.project_id))
      historyByProject.set(r.project_id, []);
    historyByProject.get(r.project_id).push(r.tokens);
  }
  for (const sample of historyByProject.values()) sample.sort((a, b) => a - b);
  const outlier = [...rows]
    .sort((a, b) => b.tokens - a.tokens)
    .find((r) => {
      const sample = historyByProject.get(r.project_id) || [];
      return (
        sample.length >= 5 &&
        r.tokens > Math.max(1, sample[Math.floor(sample.length / 2)]) * 3
      );
    });
  if (outlier)
    insights.push({
      id: "large",
      title: "An unusually large usage event",
      detail: `${outlier.tokens.toLocaleString()} tokens, over 3× the project's previous-period median. Usage alone does not indicate wasted work.`,
      threadId: outlier.thread_id,
    });
  const failure = threadRows(query).find((r) => r.error_events >= 2);
  if (failure)
    insights.push({
      id: "failures",
      title: "Repeated observed tool failures",
      detail: `${failure.error_events} explicit failures in ${failure.title}. Inspect the timeline for context.`,
      threadId: failure.id,
    });
  const today = selectedRows({ ...query, range: "today" }, now);
  return {
    totals: current,
    today: totals(today.rows),
    window,
    ratios: {
      cacheRatio: current.input_tokens
        ? (100 * current.cached_input_tokens) / current.input_tokens
        : 0,
    },
    efficiency: {
      errorRate: current.tool_events
        ? (100 * current.error_events) / current.tool_events
        : null,
    },
    comparison: {
      available: window.comparable,
      current: current.total_tokens,
      previous: before.total_tokens,
      delta: current.total_tokens - before.total_tokens,
      percent: before.total_tokens
        ? (100 * (current.total_tokens - before.total_tokens)) /
          before.total_tokens
        : null,
      projects,
      models,
    },
    insights,
    costs: costEstimate(rows),
    generatedAt: new Date(now).toISOString(),
  };
}
export function costEstimate(rows) {
  const prefs = preferences();
  let usd = 0,
    covered = 0;
  if (prefs.costsEnabled)
    for (const r of rows) {
      const rate = prefs.rates
        .filter(
          (p) =>
            p.model === r.model &&
            p.effectiveDate <= r.occurred_at.slice(0, 10),
        )
        .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
      if (!rate) continue;
      covered++;
      usd +=
        ((r.input_tokens - r.cached_input_tokens) * rate.input +
          r.cached_input_tokens * rate.cached +
          r.output_tokens * rate.output) /
        1e6;
    }
  return {
    enabled: prefs.costsEnabled,
    usd,
    covered,
    unpriced: rows.length - covered,
    label: "API-equivalent estimate (USD)",
    rates: prefs.rates,
  };
}
export function budgetResponse(now = Date.now()) {
  const all = usageRows(),
    definitions = allRows("SELECT * FROM budgets");
  const limits = new Map(
    definitions.map((b) => [
      JSON.stringify([b.scope_type, b.scope_id, b.period]),
      b.token_limit,
    ]),
  );
  const usage = new Map();
  for (const row of all) {
    const age = now - Date.parse(row.occurred_at);
    if (age < 0 || age > 30 * 86400000) continue;
    for (const days of [7, 30]) {
      if (age > days * 86400000) continue;
      for (const key of [
        JSON.stringify(["global", "all", days]),
        JSON.stringify(["project", row.project_id, days]),
      ]) {
        const value = usage.get(key) || { used: 0, expiring: 0 };
        value.used += row.tokens;
        if (age > (days - 1) * 86400000) value.expiring += row.tokens;
        usage.set(key, value);
      }
    }
  }
  const status = (scope, id, days, p) => {
    const limit = limits.get(JSON.stringify([scope, id, p])) || 0;
    const { used, expiring } = usage.get(JSON.stringify([scope, id, days])) || {
      used: 0,
      expiring: 0,
    };
    const projected = Math.max(0, used - expiring + used / days);
    return {
      limit,
      used,
      percent: limit ? (100 * used) / limit : 0,
      projected,
      expiring,
      nextDayEstimate: true,
    };
  };
  return {
    global: {
      weekly: status("global", "all", 7, "weekly"),
      monthly: status("global", "all", 30, "monthly"),
    },
    projects: allRows(
      "SELECT p.id,p.name,coalesce(a.label,'') AS alias FROM projects p LEFT JOIN annotations a ON a.kind='project' AND a.id=p.id",
    ).map((p) => ({
      id: p.id,
      name: p.alias || p.name,
      weekly: status("project", p.id, 7, "weekly"),
      monthly: status("project", p.id, 30, "monthly"),
    })),
  };
}
export function evaluateAlerts(now = Date.now()) {
  const db = getDb(),
    prefs = preferences(),
    budgets = budgetResponse(now);
  const scopes = [
    { type: "global", id: "all", name: "All projects", ...budgets.global },
    ...budgets.projects.map((p) => ({ ...p, type: "project" })),
  ];
  for (const scope of scopes)
    for (const p of ["weekly", "monthly"])
      for (const threshold of prefs.thresholds) {
        const key = `${scope.type}:${scope.id}:${p}:${threshold}`,
          was = db
            .prepare("SELECT exceeded FROM alert_state WHERE id=?")
            .get(key)?.exceeded;
        const exceeded = scope[p].limit > 0 && scope[p].percent >= threshold;
        if (exceeded && !was) {
          if (prefs.snoozedUntil && Date.parse(prefs.snoozedUntil) > now)
            continue;
          const message = `${scope.name}: ${p === "weekly" ? "7-day" : "30-day"} budget reached ${threshold}% (${Math.round(scope[p].percent)}% used).`;
          db.prepare(
            "INSERT OR IGNORE INTO alerts VALUES (?,?,?,?,?,?,?,0)",
          ).run(
            `${key}:${now}`,
            message,
            new Date(now).toISOString(),
            scope.type,
            scope.id,
            p,
            threshold,
          );
        }
        if (Number(exceeded) === was || (!exceeded && was === undefined))
          continue;
        db.prepare(
          "INSERT INTO alert_state VALUES (?,?) ON CONFLICT(id) DO UPDATE SET exceeded=excluded.exceeded",
        ).run(key, Number(exceeded));
      }
  return allRows("SELECT * FROM alerts ORDER BY created_at DESC LIMIT 100");
}
