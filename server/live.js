import fs from "node:fs";
import path from "node:path";
import { runHistoricalIngest } from "./importer.js";
import { preferences, codexHome, retentionCutoff } from "./preferences.js";
import { evaluateAlerts } from "./analytics.js";
import { getDb } from "./db.js";
import { appConfig } from "./config.js";

export function startLiveSync(log) {
  let watcher,
    watched = "",
    debounce,
    lastRun = 0,
    stopped = false;
  const sync = async () => {
    if (stopped) return;
    try {
      await runHistoricalIngest();
      getDb()
        .prepare("DELETE FROM turns WHERE occurred_at < ?")
        .run(retentionCutoff());
      evaluateAlerts();
      lastRun = Date.now();
    } catch (error) {
      log.error(error);
    }
  };
  const tick = () => {
    const prefs = preferences(),
      folder = path.join(codexHome(), "sessions");
    if ((!prefs.live || watched !== folder) && watcher) {
      watcher.close();
      watcher = null;
      watched = "";
    }
    if (prefs.live && !watcher && fs.existsSync(folder)) {
      try {
        watcher = fs.watch(folder, { recursive: true }, () => {
          clearTimeout(debounce);
          debounce = setTimeout(sync, 1000);
        });
        watched = folder;
        watcher.on("error", () => {
          watcher?.close();
          watcher = null;
          watched = "";
        });
      } catch {
        /* Polling remains available on filesystems without recursive watches. */
      }
    }
    const interval = prefs.live
      ? prefs.syncSeconds * 1000
      : appConfig.autoIngestIntervalMs;
    if (
      (prefs.live || appConfig.autoIngest) &&
      Date.now() - lastRun >= interval
    ) {
      lastRun = Date.now();
      void sync();
    }
  };
  tick();
  const timer = setInterval(tick, 2000);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(debounce);
    watcher?.close();
  };
}
