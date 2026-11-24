export function uniqueOptions(rows, key, fallback = "") {
  return [...new Set(rows.map((row) => String(row[key] || fallback)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: value }));
}