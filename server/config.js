import path from "node:path";
import os from "node:os";
export const defaultDbPath = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"),
  "codex-token-monitor",
  "token-monitor.sqlite",
);

export const appConfig = {
  port: Number(process.env.TOKEN_MONITOR_PORT || 4319),
  codexHome: process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  dbPath: process.env.TOKEN_MONITOR_DB || defaultDbPath,
  legacyDbPath: path.join(
    os.tmpdir(),
    "codex-token-monitor",
    "token-monitor.sqlite",
  ),
  privacyMode: "metrics_only",
  autoIngest: process.env.TOKEN_MONITOR_AUTO_INGEST !== "false",
  autoIngestIntervalMs: Number(
    process.env.TOKEN_MONITOR_INGEST_INTERVAL_MS || 24 * 60 * 60 * 1000,
  ),
  secretFileNames: new Set([
    "auth.json",
    "cap_sid",
    "chrome-native-hosts.json",
    "chrome-native-hosts-v2.json",
  ]),
  secretNamePatterns: [/token/i, /credential/i, /secret/i, /cookie/i],
};

export function isDeniedCodexPath(filePath) {
  const base = path.basename(filePath);
  if (appConfig.secretFileNames.has(base)) return true;
  return appConfig.secretNamePatterns.some((pattern) => pattern.test(base));
}
