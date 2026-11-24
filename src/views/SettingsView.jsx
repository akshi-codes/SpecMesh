import { useState } from "react";
import { Download, Plus, Trash2, RefreshCw } from "lucide-react";
import { Card, CardHeader, Button } from "../components/ui.jsx";
import { Field } from "../components/Interactions.jsx";
import { BudgetEditor } from "../components/BudgetEditor.jsx";
import { api } from "../lib/api.js";
export function SettingsView({
  settings,
  budgets,
  projects,
  onSaveBudget,
  onForceIngest,
  onMutate,
  toast,
}) {
  const [folder, setFolder] = useState(settings.codexHome),
    [diagnostic, setDiagnostic] = useState(null),
    [interval, setIntervalValue] = useState(settings.syncSeconds),
    [thresholds, setThresholds] = useState(settings.thresholds.join(", "));
  const [retention, setRetention] = useState(settings.retentionDays),
    [confirmRetention, setConfirmRetention] = useState(false),
    [backup, setBackup] = useState(null),
    [confirmRestore, setConfirmRestore] = useState(false),
    [busy, setBusy] = useState("");
  const [costs, setCosts] = useState(settings.costsEnabled),
    [rates, setRates] = useState(settings.rates);
  async function action(name, fn) {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy("");
    }
  }
  const saveSettings = async (value) => {
    await onMutate("/api/settings", value);
    toast("Settings saved.");
  };
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Your local data source"
          description="Check the folder before importing. No account connection is required."
        />
        <div className="space-y-4 p-5">
          <Field
            label="Codex home folder"
            hint="The folder that contains sessions, usually your user profile's .codex folder."
          >
            <input
              value={folder}
              onChange={(e) => {
                setFolder(e.target.value);
                setDiagnostic(null);
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!!busy}
              onClick={() =>
                action("check", async () =>
                  setDiagnostic(
                    await api("/api/diagnostics", {
                      method: "POST",
                      body: JSON.stringify({ path: folder }),
                    }),
                  ),
                )
              }
            >
              {busy === "check" ? "Checking…" : "Check folder"}
            </Button>
            <Button
              disabled={
                !!busy || !diagnostic?.valid || diagnostic.path !== folder
              }
              onClick={() =>
                action("source", () => saveSettings({ codexHome: folder }))
              }
            >
              Use this folder
            </Button>
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={() => action("scan", onForceIngest)}
            >
              <RefreshCw size={15} />
              Rebuild metrics
            </Button>
          </div>
          {diagnostic && (
            <p
              role="status"
              className={`rounded-lg border p-3 text-sm ${diagnostic.valid ? "border-accent/30" : "border-warning/30"}`}
            >
              {diagnostic.message} {diagnostic.files} session files found.
            </p>
          )}
          <p className="text-xs leading-5 text-mutedForeground">
            Only usage counts, timestamps, paths, model names, identifiers, and
            your own labels are stored. Prompts, replies, and tool output are
            excluded. A rebuild preserves budgets and organization.
          </p>
        </div>
      </Card>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Freshness and alerts"
            description="Live updates and notifications work while the local app is running."
          />
          <form
            className="space-y-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void action("sync", () =>
                saveSettings({
                  syncSeconds: Number(interval),
                  thresholds: [
                    ...new Set(
                      thresholds.split(",").map((s) => Number(s.trim())),
                    ),
                  ],
                }),
              );
            }}
          >
            <Field
              label="Reconcile every (seconds)"
              hint="Live mode also watches for file changes. The dashboard checks for updates every five seconds."
            >
              <input
                type="number"
                min={10}
                max={3600}
                required
                value={interval}
                onChange={(e) => setIntervalValue(e.target.value)}
              />
            </Field>
            <Field
              label="Budget alert thresholds (%)"
              hint="Comma separated. Alert once when crossing a threshold; rearm after usage falls below it."
            >
              <input
                required
                value={thresholds}
                onChange={(e) => setThresholds(e.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!!busy}>
                Save preferences
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!!busy}
                onClick={() =>
                  action("unsnooze", () => saveSettings({ snoozedUntil: null }))
                }
              >
                Resume alerts
              </Button>
            </div>
            {settings.snoozedUntil &&
              Date.parse(settings.snoozedUntil) > Date.now() && (
                <p className="text-xs text-mutedForeground">
                  Snoozed until{" "}
                  {new Date(settings.snoozedUntil).toLocaleString()}.
                </p>
              )}
          </form>
        </Card>
        <Card>
          <CardHeader
            title="Backup and restore"
            description="A portable snapshot of metrics, budgets, labels, and settings."
          />
          <div className="space-y-4 p-5">
            <a href="/api/backup" className="export-link-button">
              <Download size={16} />
              Download backup
            </a>
            <p className="break-all text-xs text-mutedForeground">
              Database: {settings.dbPath}
            </p>
            <Field label="Choose a backup to restore">
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setBackup(null);
                  setConfirmRestore(false);
                  if (!file) return;
                  void action("read", async () => {
                    if (file.size > 100 * 1024 * 1024)
                      throw new Error(
                        "This backup exceeds the 100 MB import limit.",
                      );
                    const b = JSON.parse(await file.text());
                    if (
                      b.format !== "token-monitor" ||
                      ![2,3].includes(b.version) ||
                      !b.tables
                    )
                      throw new Error("Choose a Token Monitor v2 or Companion v3 backup.");
                    setBackup(b);
                  });
                }}
              />
            </Field>
            {backup && (
              <>
                <p className="text-sm">
                  Backup from {new Date(backup.createdAt).toLocaleString()};{" "}
                  {backup.tables.turns?.length || 0} usage events.
                </p>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={confirmRestore}
                    onChange={(e) => setConfirmRestore(e.target.checked)}
                  />
                  Replace the current local database with this backup. Download
                  a current backup first if you want to keep it.
                </label>
                <Button
                  disabled={!!busy || !confirmRestore}
                  onClick={() =>
                    action("restore", async () => {
                      await onMutate("/api/restore", backup, "POST");
                      setBackup(null);
                      toast("Backup restored. Reloading settings.");
                      location.reload();
                    })
                  }
                >
                  Restore backup
                </Button>
              </>
            )}
          </div>
        </Card>
      </div>
      <BudgetEditor
        budgets={budgets}
        projects={budgets.projects}
        onSaveBudget={onSaveBudget}
      />
      <Card>
        <CardHeader
          title="History retention"
          description="Choose how much imported history to keep. Budgets and labels are preserved."
        />
        <div className="space-y-4 p-5">
          <Field
            label="Keep the last (days)"
            hint="0 keeps all history. Older records stay excluded on future scans until you change this setting."
          >
            <input
              type="number"
              min={0}
              max={36500}
              value={retention}
              onChange={(e) => {
                setRetention(Number(e.target.value));
                setConfirmRetention(false);
              }}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmRetention}
              onChange={(e) => setConfirmRetention(e.target.checked)}
            />
            Apply this policy and remove older imported usage from the monitor.
          </label>
          <Button
            disabled={!!busy || !confirmRetention}
            variant="secondary"
            onClick={() =>
              action("retention", async () => {
                const result = await onMutate(
                  "/api/retention",
                  { days: retention, confirm: true },
                  "POST",
                );
                setConfirmRetention(false);
                toast(`${result.deleted} older usage events removed.`);
              })
            }
          >
            Apply retention
          </Button>
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Optional cost estimates"
          description="Maintain your own dated USD rates per million tokens. Estimates are not subscription bills or remaining allowance."
        />
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void action("rates", () =>
              saveSettings({ costsEnabled: costs, rates }),
            );
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={costs}
              onChange={(e) => setCosts(e.target.checked)}
            />
            Show API-equivalent estimates
          </label>
          <div className="space-y-4">
            {rates.map((rate, i) => (
              <div
                key={i}
                className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2 xl:grid-cols-6"
              >
                {[
                  ["model", "Model"],
                  ["effectiveDate", "Effective date"],
                  ["input", "Input / 1M"],
                  ["cached", "Cached / 1M"],
                  ["output", "Output / 1M"],
                ].map(([key, label]) => (
                  <Field key={key} label={label}>
                    <input
                      required
                      type={
                        key === "model"
                          ? "text"
                          : key === "effectiveDate"
                            ? "date"
                            : "number"
                      }
                      min={0}
                      step="any"
                      value={rate[key]}
                      onChange={(e) =>
                        setRates((old) =>
                          old.map((r, n) =>
                            n === i
                              ? {
                                  ...r,
                                  [key]: ["model", "effectiveDate"].includes(
                                    key,
                                  )
                                    ? e.target.value
                                    : Number(e.target.value),
                                }
                              : r,
                          ),
                        )
                      }
                    />
                  </Field>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove rate ${i + 1}`}
                  onClick={() => setRates((r) => r.filter((_, n) => n !== i))}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setRates((r) => [
                  ...r,
                  {
                    model: "",
                    effectiveDate: new Date().toISOString().slice(0, 10),
                    input: 0,
                    cached: 0,
                    output: 0,
                  },
                ])
              }
            >
              <Plus size={15} />
              Add dated rate
            </Button>
            <Button type="submit" disabled={!!busy}>
              Save cost settings
            </Button>
          </div>
          <p className="text-xs text-mutedForeground">
            Unpriced models remain explicitly unpriced. A rate applies from its
            effective date until a newer rate for that model takes effect.
            Reasoning is included in output.
          </p>
        </form>
      </Card>
    </div>
  );
}
