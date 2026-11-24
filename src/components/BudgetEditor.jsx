import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Save } from "lucide-react";
import { Button, Card, CardHeader } from "../components/ui.jsx";
export function BudgetEditor({ budgets, projects, onSaveBudget }) {
  const [globalWeekly, setGlobalWeekly] = useState("");
  const [globalMonthly, setGlobalMonthly] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectWeekly, setProjectWeekly] = useState("");
  const [projectMonthly, setProjectMonthly] = useState("");
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    if (!confirmation) return undefined;
    const timeout = window.setTimeout(() => setConfirmation(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [confirmation]);

  useEffect(() => {
    setGlobalWeekly(String(budgets?.global?.weekly?.limit || ""));
    setGlobalMonthly(String(budgets?.global?.monthly?.limit || ""));
  }, [budgets?.global?.weekly?.limit, budgets?.global?.monthly?.limit]);

  useEffect(() => {
    if (!projectId && projects?.[0]?.id) setProjectId(projects[0].id);
  }, [projectId, projects]);

  const selectedBudget = useMemo(
    () => budgets?.projects?.find((project) => project.id === projectId),
    [budgets, projectId],
  );
  useEffect(() => {
    setProjectWeekly(String(selectedBudget?.weekly?.limit || ""));
    setProjectMonthly(String(selectedBudget?.monthly?.limit || ""));
  }, [
    selectedBudget?.weekly?.limit,
    selectedBudget?.monthly?.limit,
    projectId,
  ]);

  async function saveGlobal() {
    setSavingGlobal(true);
    try {
      await onSaveBudget({
        scopeType: "global",
        scopeId: "all",
        limits: { weekly: globalWeekly, monthly: globalMonthly },
      });
    } catch {
      /* The parent displays API errors. */
    } finally {
      setSavingGlobal(false);
    }
  }

  async function saveProject() {
    if (!projectId) return;
    setSavingProject(true);
    try {
      await onSaveBudget({
        scopeType: "project",
        scopeId: projectId,
        limits: { weekly: projectWeekly, monthly: projectMonthly },
      });
    } catch {
      /* The parent displays API errors. */
    } finally {
      setSavingProject(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Local usage controls"
          eyebrow="Token budgets"
          description="Set rolling 7-day and 30-day limits for total usage or a selected project. Enter 0 or clear a value to disable that budget."
        />
        <div className="grid gap-6 p-5 lg:grid-cols-2">
          <BudgetForm
            title="Global budget"
            weekly={globalWeekly}
            monthly={globalMonthly}
            setWeekly={setGlobalWeekly}
            setMonthly={setGlobalMonthly}
            onSave={saveGlobal}
            saving={savingGlobal}
            anchorAction
          />
          <BudgetForm
            title="Project budget"
            weekly={projectWeekly}
            monthly={projectMonthly}
            setWeekly={setProjectWeekly}
            setMonthly={setProjectMonthly}
            onSave={saveProject}
            saving={savingProject}
            disabled={!projectId}
          >
            <label className="block text-xs font-bold uppercase text-mutedForeground">
              Project
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className="select-control mt-2 w-full"
              >
                {(projects || []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          </BudgetForm>
        </div>
      </Card>
      {confirmation ? (
        <div
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg border border-accent/30 bg-card px-4 py-3 text-sm font-bold text-foreground shadow-lift ring-1 ring-accent/10 animate-slide-up"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 className="text-accent" size={18} />
          {confirmation}
        </div>
      ) : null}
    </>
  );
}

function BudgetForm({
  title,
  weekly,
  monthly,
  setWeekly,
  setMonthly,
  onSave,
  saving,
  disabled = false,
  anchorAction = false,
  children,
}) {
  return (
    <div
      className={
        anchorAction
          ? "flex h-full flex-col rounded-xl border border-border/80 bg-muted/30 p-4"
          : "rounded-xl border border-border/80 bg-muted/30 p-4"
      }
    >
      <h3 className="font-bold text-foreground">{title}</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <BudgetInput label="7-day tokens" value={weekly} onChange={setWeekly} />
        <BudgetInput
          label="30-day tokens"
          value={monthly}
          onChange={setMonthly}
        />
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
      <div className={anchorAction ? "mt-auto pt-6" : "mt-4"}>
        <Button
          className="self-start"
          variant="secondary"
          onClick={onSave}
          disabled={disabled || saving}
        >
          <Save size={15} /> {saving ? "Saving..." : "Save limits"}
        </Button>
      </div>
    </div>
  );
}

function BudgetInput({ label, value, onChange }) {
  const numericValue = Math.max(0, Number(value) || 0);
  const sliderValue =
    numericValue <= 0
      ? 0
      : Math.round(1 + ((Math.log10(numericValue) - 3) / 9) * 999);
  const compactValue = numericValue
    ? new Intl.NumberFormat(undefined, {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(numericValue)
    : "Off";

  function updateFromSlider(position) {
    const nextPosition = Number(position);
    if (nextPosition === 0) return onChange("");
    const exponent = 3 + ((nextPosition - 1) / 999) * 9;
    const raw = 10 ** exponent;
    const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(raw)) - 1);
    onChange(String(Math.round(raw / magnitude) * magnitude));
  }

  return (
    <div className="rounded-lg border border-border/80 bg-card/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <label
          className="text-xs font-bold uppercase text-mutedForeground"
          htmlFor={`budget-${label}`}
        >
          {label}
        </label>
        <span className="rounded-md bg-accent/10 px-2 py-1 text-xs font-bold text-accent">
          {compactValue}
        </span>
      </div>
      <input
        id={`budget-${label}`}
        inputMode="numeric"
        value={numericValue ? numericValue.toLocaleString("en-US") : ""}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
        placeholder="No limit"
        aria-label={`${label} exact value`}
        className="mt-3 h-10 w-full rounded-lg border border-border bg-card px-3 text-base font-bold tabular-nums text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
      <input
        type="range"
        min="0"
        max="1000"
        value={Math.min(1000, Math.max(0, sliderValue))}
        onChange={(event) => updateFromSlider(event.target.value)}
        aria-label={`${label} slider`}
        className="budget-slider mt-4 w-full"
      />
      <div className="mt-1 flex justify-between text-[10px] font-semibold text-mutedForeground">
        <span>Off</span>
        <span>1K</span>
        <span>1M</span>
        <span>1B</span>
        <span>1T</span>
      </div>
      <div
        className="mt-3 grid grid-cols-4 gap-1.5"
        aria-label={`${label} presets`}
      >
        {[1_000_000, 10_000_000, 100_000_000, 1_000_000_000].map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(String(preset))}
            className="h-7 rounded-md border border-border bg-muted/60 text-xs font-bold text-mutedForeground transition hover:border-accent/60 hover:text-foreground"
          >
            {new Intl.NumberFormat(undefined, { notation: "compact" }).format(
              preset,
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
        {label}
      </p>
      <p className="mt-1 break-all font-medium">{value || "Not available"}</p>
    </div>
  );
}
