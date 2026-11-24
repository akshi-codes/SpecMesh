import { useEffect, useState } from "react";
import { CalendarDays, Download, Link } from "lucide-react";
import { Menu, Field } from "./Interactions.jsx";
import { Button } from "./ui.jsx";
export const rangeLabels = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
  custom: "Custom dates",
};
export function DateControls({ query, onChange, queryString, toast }) {
  const [from, setFrom] = useState(query.from || ""),
    [to, setTo] = useState(query.to || "");
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    setFrom(query.from || "");
    setTo(query.to || "");
  }, [query.from, query.to]);
  return (
    <>
      <Menu
        label={rangeLabels[query.range] || "Last 30 days"}
        icon={<CalendarDays size={15} />}
      >
        {(close) => (
          <>
            <div className="grid grid-cols-2 gap-1">
              {Object.entries(rangeLabels)
                .filter(([k]) => k !== "custom")
                .map(([id, label]) => (
                  <button
                    key={id}
                    className={`export-menu-item ${query.range === id ? "bg-accentSoft" : ""}`}
                    onClick={() => {
                      onChange({ range: id });
                      close();
                    }}
                  >
                    {label}
                  </button>
                ))}
            </div>
            <form
              className="mt-3 space-y-3 border-t border-border pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                onChange({ range: "custom", from, to });
                close();
              }}
            >
              <Field label="From">
                <input
                  type="date"
                  required
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
              <Field label="Through">
                <input
                  type="date"
                  required
                  min={from}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
              <Button size="sm" type="submit">
                Apply dates
              </Button>
            </form>
            <Field label="Reporting timezone">
              <select
                value={query.timezone}
                onChange={(e) => onChange({ timezone: e.target.value })}
              >
                {[
                  ...new Set(
                    ["UTC", localZone, query.timezone].filter(Boolean),
                  ),
                ].map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </Field>
          </>
        )}
      </Menu>
      <Menu label="Export" icon={<Download size={15} />}>
        {(close) => (
          <>
            <a
              className="export-menu-item"
              onClick={close}
              href={`/api/export.csv?${queryString}`}
            >
              Detailed CSV
            </a>
            <a
              className="export-menu-item"
              onClick={close}
              href={`/api/export.csv?${queryString}&format=daily`}
            >
              Daily summary CSV
            </a>
            <button
              className="export-menu-item"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(location.href);
                  toast("Local view link copied.");
                  close();
                } catch {
                  toast("Copy the address from your browser instead.", "error");
                }
              }}
            >
              <Link size={14} />
              Copy local view link
            </button>
            <p className="px-3 py-2 text-xs text-mutedForeground">
              Links open this view on the same local installation.
            </p>
          </>
        )}
      </Menu>
    </>
  );
}
