import crypto from "node:crypto";
import path from "node:path";

export function stableId(input) {
  return crypto
    .createHash("sha256")
    .update(String(input))
    .digest("hex")
    .slice(0, 24);
}

export function toIso(value, fallback = new Date()) {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date.getTime())
    ? fallback.toISOString()
    : date.toISOString();
}

export function projectFromPath(projectPath) {
  const normalized = projectPath || "Unknown project";
  const name =
    normalized === "Unknown project" ? normalized : path.basename(normalized);
  const id = stableId(normalized.toLowerCase());
  return { id, name, path: normalized };
}

export function safeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export function tokenTotal(row) {
  return row.source_total == null
    ? safeNumber(row.input_tokens) + safeNumber(row.output_tokens)
    : safeNumber(row.source_total);
}

export function rangeStart(range) {
  const now = new Date();
  const days =
    { "7d": 7, "30d": 30, "90d": 90, all: 36500 }[range || "30d"] || 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
