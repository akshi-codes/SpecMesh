import { allRows, getDb, oneRow } from "./db.js";
import { appConfig } from "./config.js";

export const defaults = {
  live: false,
  syncSeconds: 30,
  retentionDays: 0,
  thresholds: [80, 100],
  snoozedUntil: null,
  costsEnabled: false,
  rates: [],
  codexHome: null,
};
export function preferences() {
  const saved = Object.fromEntries(
    allRows("SELECT * FROM preferences").map((r) => [
      r.key,
      JSON.parse(r.value),
    ]),
  );
  return { ...defaults, ...saved };
}
export function savePreferences(values) {
  const db = getDb();
  for (const [key, value] of Object.entries(values)) {
    if (!(key in defaults)) continue;
    db.prepare(
      "INSERT INTO preferences VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(key, JSON.stringify(value));
  }
  return preferences();
}
export function codexHome() {
  return preferences().codexHome || appConfig.codexHome;
}
export function annotation(kind, id) {
  const row = oneRow("SELECT * FROM annotations WHERE kind=? AND id=?", [
    kind,
    id,
  ]);
  return row
    ? {
        ...row,
        tags: JSON.parse(row.tags),
        bookmarked: Boolean(row.bookmarked),
      }
    : { label: "", tags: [], bookmarked: false, group_name: "" };
}
export function retentionCutoff(now = Date.now()) {
  const days = preferences().retentionDays;
  return days
    ? new Date(now - days * 86400000).toISOString()
    : "1900-01-01T00:00:00.000Z";
}
