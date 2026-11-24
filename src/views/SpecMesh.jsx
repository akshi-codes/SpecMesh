import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, Controls, MarkerType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  GitBranch,
  Plus,
  Upload,
  Download,
  FileText,
  ShieldCheck,
  AlertTriangle,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { api } from "../lib/api.js";
import { Button } from "../components/ui.jsx";
import { Field, Sheet } from "../components/Interactions.jsx";
import { useStoredState } from "../hooks/useStoredState.js";

const download = (name, value) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const Status = ({ children, good = false }) => (
  <span className={`mesh-status ${good ? "mesh-good" : ""}`}>{children}</span>
);
const tabs = [
  "Stories",
  "Dependencies",
  "Contracts",
  "Decisions",
  "Readiness",
  "Exchange",
];
export default function SpecMesh({ user, teams }) {
  const [key, setKey] = useStoredState(`specmesh-project:${user.id}`, "");
  const [projects, setProjects] = useState([]),
    [state, setState] = useState(null),
    [tab, setTab] = useState("Stories"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [create, setCreate] = useState(false),
    [draft, setDraft] = useState(false),
    [selected, setSelected] = useState(null),
    [report, setReport] = useState(null);
  const base = "/api/workspace/specmesh",
    url = base + "/" + key;
  const activeKey = useRef(key), busyRef = useRef(false), request = useRef(0), listRequest = useRef(0);
  activeKey.current = key;
  async function list() {
    const serial = ++listRequest.current;
    const value = await api(base);
    if (serial !== listRequest.current) return;
    setProjects(value);
    setKey((old) => value.some((p) => p.key === old) ? old : value[0]?.key || "");
  }
  useEffect(() => {
    list().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      if (!document.hidden && !busyRef.current) list().catch((e) => setError(e.message));
    }, 15000);
    return () => { ++listRequest.current; clearInterval(timer); };
  }, []);
  async function refresh(projectKey = key, background = false) {
    if (!projectKey) return;
    const serial = ++request.current;
    try {
      const value = await api(base + "/" + projectKey);
      if (activeKey.current === projectKey && serial === request.current) {
        setState((old) => old?.revision === value.revision ? old : value);
        if (!background) setError("");
      }
    } catch (e) {
      if (activeKey.current === projectKey && serial === request.current) setError(e.message);
      if (!background) throw e;
    }
  }
  useEffect(() => {
    ++request.current;
    setState(null);
    setSelected(null);
    setReport(null);
    setDraft(false);
    setError("");
    setNotice("");
    void refresh(key, true);
    const timer = setInterval(() => {
      if (!document.hidden && !busyRef.current) void refresh(key, true);
    }, 15000);
    return () => {
      ++request.current;
      clearInterval(timer);
    };
  }, [key]);
  useEffect(() => { setReport(null); }, [state?.revision, key]);
  const lead = state?.project.teamId
    ? teams.some((t) => t.id === state.project.teamId && t.role === "lead")
    : state?.project.ownerId === user.id;
  async function run(fn, message) {
    if (busyRef.current) return;
    busyRef.current = true;
    ++request.current;
    ++listRequest.current;
    const operationKey = key;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await fn();
      if (message && activeKey.current === operationKey) setNotice(message);
      return value;
    } catch (e) {
      if (activeKey.current === operationKey) setError(e.message);
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function change(path, body, method = "POST") {
    const value = await api(url + path, { method, body: JSON.stringify(body) });
    if (activeKey.current === key) setState(value);
    return value;
  }
  async function importFiles(files) {
    const selected = [...files];
    if (selected.some((f) => f.size > 100000))
      throw Error("Each document must be under 100 KB.");
    const value = await change("/import", {
      files: await Promise.all(
        selected.map(async (f) => ({
          path: f.webkitRelativePath || f.name,
          content: await f.text(),
        })),
      ),
    });
    await list();
    return value;
  }
  function openDetail(kind, value) {
    setError("");
    setNotice("");
    setSelected({ kind, value });
  }
  const selectContract = (c) => openDetail("contract", c);
  const selectedStory = selected?.kind === "story" && state?.stories.find((s) => s.id === selected.value.id);
  const selectedContract = selected?.kind === "contract" && state?.contracts.find((c) => c.id === selected.value.id && c.version === selected.value.version);
  const feedback = <>{error && <div role="alert" className="work-error">{error}</div>}{notice && <p role="status" className="mesh-notice">{notice}</p>}</>;
  return (
    <div className="mesh-workspace">
      <div className="mesh-header">
        <div>
          <p className="workspace-eyebrow">SPECIFICATION COORDINATION</p>
          <h1>SpecMesh</h1>
          <p className="workspace-description">
            Agree on the interface. Keep parallel work connected.
          </p>
        </div>
        <Button disabled={busy} onClick={() => { setError(""); setNotice(""); setCreate(true); }}>
          <Plus size={16} />
          New project
        </Button>
      </div>
      {error && (
        <div role="alert" className="work-error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="mesh-notice">
          {notice}
          <button
            onClick={() => setNotice("")}
            aria-label="Dismiss SpecMesh notification"
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="mesh-projectbar">
        <label>
          Project{" "}
          <select
            aria-label="SpecMesh project"
            value={key}
            disabled={busy}
            onChange={(e) => setKey(e.target.value)}
          >
            <option value="">Choose a project</option>
            {projects.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
                {p.demo ? " · DEMO" : ""}
              </option>
            ))}
          </select>
        </label>
        {key && <Button size="sm" disabled={busy} onClick={() => void run(() => refresh(), "Project refreshed.")}><RefreshCw size={14} /> Refresh</Button>}
        {state && (
          <>
            <Status good={state.analysisCurrent}>
              {state.analysisCurrent ? "Analysis current" : "Analysis needed"}
            </Status>
            <span className="text-xs text-mutedForeground">
              {state.project.demo
                ? "Synthetic demo sources"
                : state.project.teamId
                  ? "Shared team project"
                  : "Private project"}
            </span>
          </>
        )}
      </div>
      {!state ? (
        <div className="work-empty">
          <GitBranch size={32} />
          <h3>{key ? "Opening project…" : "Start with a set of stories"}</h3>
          <p>
            Create a project and import selected Markdown specifications,
            architecture notes, or bundled OpenAPI files. You can also create an
            explicitly labeled five-story demo.
          </p>
        </div>
      ) : (
        <>
          <div className="mesh-metrics">
            <span>
              <strong>{state.stories.length}</strong> stories
            </span>
            <span>
              <strong>
                {state.contracts.filter((c) => c.status === "APPROVED").length}
              </strong>{" "}
              approved versions
            </span>
            <span>
              <strong>
                {state.analysis?.decisions.filter((d) => d.status === "OPEN")
                  .length || 0}
              </strong>{" "}
              open decisions
            </span>
            <span>
              <strong>
                {state.readiness.filter((r) => r.contractReady).length}
              </strong>{" "}
              contract-ready
            </span>
          </div>
          <nav aria-label="SpecMesh sections" className="mesh-tabs">
            {tabs.map((t) => (
              <button
                key={t}
                aria-current={tab === t ? "page" : undefined}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          {tab === "Stories" && (
            <>
              <div className="mesh-section-heading">
                <div>
                  <h2>Shared requirements</h2>
                  <p>
                    Source references stay attached. Missing acceptance criteria
                    stay missing.
                  </p>
                </div>
                {lead && (
                  <label className="mesh-upload">
                    <Upload size={15} />
                    Import documents
                    <input
                      type="file"
                      multiple
                      accept=".md,.json,.yaml,.yml"
                      disabled={busy}
                      onChange={(e) => {
                        const files = [...e.target.files];
                        e.target.value = "";
                        void run(
                          () => importFiles(files),
                          "Documents imported. Changed sources require fresh analysis.",
                        );
                      }}
                    />
                  </label>
                )}
              </div>
              <div className="mesh-table-wrap">
                <table className="work-table">
                  <thead>
                    <tr>
                      <th>Story</th>
                      <th>Source</th>
                      <th>Assigned to</th>
                      <th>Contract readiness</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {state.stories.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <button
                            className="mesh-story-link"
                            onClick={() =>
                              openDetail("story", s)
                            }
                          >
                            <small>{s.id}</small>
                            <strong>{s.title}</strong>
                          </button>
                        </td>
                        <td>
                          {s.source}:{s.line}
                        </td>
                        <td>{s.assignee || "Unassigned"}</td>
                        <td>
                          <Status
                            good={
                              state.readiness.find((r) => r.story.id === s.id)
                                ?.contractReady
                            }
                          >
                            {state.readiness.find((r) => r.story.id === s.id)
                              ?.contractReady
                              ? "Ready"
                              : "Review needed"}
                          </Status>
                        </td>
                        <td>
                          <button
                            aria-label={"Open " + s.id}
                            onClick={() =>
                              openDetail("story", s)
                            }
                          >
                            <ChevronRight size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!state.stories.length && (
                <div className="work-empty">
                  <FileText size={25} />
                  <h3>No stories imported yet</h3>
                  <p>
                    Use headings such as “# US-1 — Registration”, a “Story ID:”
                    field, or Spec Kit “### User Story 1 — …” sections.
                    Architecture documents remain context without invented
                    stories.
                  </p>
                </div>
              )}
              <div className="mesh-help">
                {state.sources.length} source documents ·{" "}
                {state.analysis?.provider || "No"} analysis provider. Use
                Exchange to run Codex on your own computer and upload its
                proposals.
              </div>
            </>
          )}
          {tab === "Dependencies" && (
            <DependencyMap
              state={state}
              lead={lead}
              busy={busy}
              onReview={(id, confirmed) =>
                run(
                  () =>
                    change(
                      "/dependencies/" + encodeURIComponent(id),
                      { confirmed },
                      "PUT",
                    ),
                  "Dependency review recorded.",
                )
              }
            />
          )}
          {tab === "Contracts" && (
            <>
              <div className="mesh-section-heading">
                <div>
                  <h2>One contract, every consumer</h2>
                  <p>
                    Approved versions are immutable. Changes create a new draft.
                  </p>
                </div>
                {lead && (
                  <Button disabled={busy} onClick={() => { setError(""); setNotice(""); setDraft(true); }}>
                    <Plus size={15} />
                    Propose contract
                  </Button>
                )}
              </div>
              {state.project.demo && lead && (
                <div className="mesh-help">
                  <strong>Demo fixture contracts</strong>
                  <p>
                    These explicit sample definitions are not AI-generated.
                    Create drafts, then review the evidence and decisions before
                    approval.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {["IdentityAPI", "BankAccountAPI", "TransferAPI"].map(
                      (id) => (
                        <Button
                          key={id}
                          size="sm"
                          disabled={
                            busy ||
                            state.contracts.some(
                              (c) => c.id === id && c.version === "1.0.0",
                            )
                          }
                          onClick={() =>
                            run(
                              () =>
                                change("/demo-contract", { interfaceId: id }),
                              "Sample draft created.",
                            )
                          }
                        >
                          {id}
                        </Button>
                      ),
                    )}
                  </div>
                </div>
              )}
              <div className="mesh-contract-list">
                {state.contracts.map((c) => (
                  <button
                    key={c.id + c.version}
                    onClick={() => selectContract(c)}
                  >
                    <ShieldCheck size={21} />
                    <span>
                      <strong>{c.id}</strong>
                      <small>
                        {c.version} · {c.providerStory} · {c.origin}
                      </small>
                    </span>
                    <Status good={c.status === "APPROVED"}>{c.status}</Status>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
              {!state.contracts.length && (
                <div className="work-empty">
                  <h3>No shared contracts yet</h3>
                  <p>
                    Propose a bundled OpenAPI 3.1 document. Validation, critical
                    questions, source freshness, and human review all gate
                    approval.
                  </p>
                </div>
              )}
            </>
          )}
          {tab === "Decisions" && (
            <>
              <div className="mesh-section-heading">
                <div>
                  <h2>Make the missing decisions visible</h2>
                  <p>
                    Critical questions block contract approval. A waiver needs
                    an explicit rationale.
                  </p>
                </div>
              </div>
              {state.analysis?.decisions.map((q) => (
                <DecisionCard
                  key={q.id + q.status}
                  decision={q}
                  lead={lead}
                  busy={busy}
                  onResolve={(status, resolution) =>
                    run(
                      () =>
                        change(
                          "/decisions/" + encodeURIComponent(q.id),
                          { status, resolution },
                          "PUT",
                        ),
                      "Decision recorded.",
                    )
                  }
                />
              ))}
              {!state.analysis?.decisions.length && (
                <div className="work-empty">
                  <h3>No recorded questions</h3>
                  <p>
                    {state.analysis
                      ? "This analysis returned no questions. That does not establish that the requirements are complete."
                      : "Import an analysis proposal to inspect architectural questions."}
                  </p>
                </div>
              )}
            </>
          )}
          {tab === "Readiness" && (
            <>
              <div className="mesh-section-heading">
                <div>
                  <h2>Know what is actually ready</h2>
                  <p>
                    Contract approval, mock availability, and real integration
                    checks are different evidence.
                  </p>
                </div>
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const r = await api(url + "/verify", {
                        method: "POST",
                        body: "{}",
                      });
                      if (activeKey.current === key) setReport(r);
                    }, "Verification finished.")
                  }
                >
                  Verify registry
                </Button>
              </div>
              {report && (
                <div className="mesh-help">
                  <strong>
                    {report.ok
                      ? "Registry checks passed"
                      : "Registry needs attention"}
                  </strong>
                  {report.errors.map((e) => (
                    <p key={e}>{e}</p>
                  ))}
                </div>
              )}
              <div className="mesh-readiness">
                {state.readiness.map((r) => (
                  <article key={r.story.id}>
                    <div>
                      <strong>
                        {r.story.id} · {r.story.title}
                      </strong>
                      <Button
                        size="sm"
                        onClick={() =>
                          download(
                            r.story.id.replaceAll(":", "-") + ".manifest.json",
                            r,
                          )
                        }
                      >
                        <Download size={14} />
                        Manifest
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Status good={r.contractReady}>
                        {r.contractReady
                          ? "Contract ready"
                          : "Contract review needed"}
                      </Status>
                      <Status>Local mocks not checked</Status>
                      <Status>Integration unverified</Status>
                    </div>
                    {[...r.blockers, ...r.developmentBlockers].map((b) => (
                      <p key={b}>{b}</p>
                    ))}
                  </article>
                ))}
              </div>
              <div className="mesh-help">
                Download the registry from Exchange, import it locally, then run{" "}
                <code>
                  npm run specmesh -- mock start BankAccountAPI --root ./project
                  --port 4010
                </code>
                . Mocks require explicit response examples and approved
                snapshots. The shared server does not run teammates’ mocks.
              </div>
            </>
          )}
          {tab === "Exchange" && (
            <Exchange
              key={key}
              state={state}
              lead={lead}
              busy={busy}
              run={run}
              url={url}
              onProposal={(b) => change("/proposals", b)}
            />
          )}
        </>
      )}
      {create && (
        <Sheet
          title="Create a coordination project"
          onClose={() => setCreate(false)}
        >
          {feedback}
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                const p = await api(base, {
                  method: "POST",
                  body: JSON.stringify({
                    name: f.get("name"),
                    teamId: f.get("team"),
                    demo: f.get("demo") === "on",
                  }),
                });
                await list();
                setKey(p.key);
                setTab("Stories");
                setCreate(false);
              }, "Project created.");
            }}
          >
            <Field label="Project name">
              <input name="name" required maxLength={120} />
            </Field>
            <Field label="Visibility">
              <select name="team">
                <option value="">Private to me</option>
                {teams
                  .filter((t) => t.role === "lead")
                  .map((t) => (
                    <option value={t.id} key={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </Field>
            <label className="flex gap-3 items-start text-sm">
              <input type="checkbox" name="demo" />
              Start with the synthetic five-story CashFlash demo. This uses
              deterministic fixture analysis, never live AI.
            </label>
            <Button disabled={busy}>Create project</Button>
          </form>
        </Sheet>
      )}
      {draft && (
        <Sheet
          title="Propose an interface contract"
          onClose={() => setDraft(false)}
        >
          {feedback}
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                await change("/contracts", {
                  id: f.get("id"),
                  version: f.get("version"),
                  providerStory: f.get("provider"),
                  document: f.get("document"),
                });
                setDraft(false);
              }, "Draft saved with validation results.");
            }}
          >
            <Field label="Canonical interface ID">
              <input
                name="id"
                required
                pattern="[A-Za-z0-9][A-Za-z0-9_.-]*"
                placeholder="BankAccountAPI"
              />
            </Field>
            <Field label="Version">
              <input
                name="version"
                required
                pattern="[0-9]+\.[0-9]+\.[0-9]+"
                defaultValue="1.0.0"
              />
            </Field>
            <Field label="Provider story">
              <select name="provider" required>
                {state?.stories.map((s) => (
                  <option key={s.id}>{s.id}</option>
                ))}
              </select>
            </Field>
            <Field label="OpenAPI 3.1 YAML or JSON">
              <textarea
                name="document"
                rows={18}
                required
                className="font-mono text-xs"
              />
            </Field>
            <p className="text-sm text-mutedForeground">
              External references are disabled. Bundle schemas into the
              document. Keep the OpenAPI info.version equal to this version.
            </p>
            <Button disabled={busy}>Validate and save draft</Button>
          </form>
        </Sheet>
      )}
      {selectedStory && (
        <StoryDetail
          story={selectedStory}
          feedback={feedback}
          lead={lead}
          busy={busy}
          onClose={() => setSelected(null)}
          onSave={(b) =>
            run(
              () =>
                change(
                  "/stories/" + encodeURIComponent(selected.value.id),
                  b,
                  "PUT",
                ),
              "Assignment updated.",
            )
          }
        />
      )}
      {selectedContract && (
        <ContractDetail
          contract={selectedContract}
          feedback={feedback}
          state={state}
          lead={lead}
          busy={busy}
          onClose={() => setSelected(null)}
          onAction={(action, b) =>
            run(
              () =>
                change(
                  "/contracts/" +
                    selected.value.id +
                    "/" +
                    selected.value.version +
                    "/" +
                    action,
                  b,
                ),
              "Contract review recorded.",
            )
          }
        />
      )}
    </div>
  );
}

function StoryDetail({ story, lead, busy, onClose, onSave, feedback }) {
  return (
    <Sheet title={story.id + " · " + story.title} onClose={onClose}>
      {feedback}
      <p className="mesh-help">
        Source: {story.source}:{story.line}
      </p>
      <pre className="mesh-code">{story.description}</pre>
      <form
        className="grid gap-4 mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void onSave({
            assignee: f.get("assignee"),
            service: f.get("service"),
          });
        }}
      >
        <Field label="Assigned developer (recorded name)">
          <input
            name="assignee"
            defaultValue={story.assignee}
            disabled={!lead}
            maxLength={120}
          />
        </Field>
        <Field label="Related service">
          <input
            name="service"
            defaultValue={story.service}
            disabled={!lead}
            maxLength={120}
          />
        </Field>
        {lead && <Button disabled={busy}>Save assignment</Button>}
      </form>
    </Sheet>
  );
}
function DecisionCard({ decision: q, lead, busy, onResolve }) {
  return (
    <article className="mesh-decision">
      <div className="flex flex-wrap gap-2">
        <Status>{q.id}</Status>
        <Status good={q.status !== "OPEN"}>{q.status}</Status>
        {q.critical && <Status>Critical</Status>}
      </div>
      <h3>{q.question}</h3>
      <p>
        {q.storyIds.join(", ")} · {q.interfaceIds.join(", ")}
      </p>
      {q.evidence.map((e, i) => (
        <blockquote key={i}>
          {e.quote}
          <small>
            {e.source}:{e.line}
          </small>
        </blockquote>
      ))}
      {q.status === "OPEN" && lead ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void onResolve(f.get("status"), f.get("resolution"));
          }}
        >
          <Field label="Decision and rationale">
            <textarea name="resolution" required maxLength={4000} rows={3} />
          </Field>
          <Field label="Disposition">
            <select name="status">
              <option value="RESOLVED">Resolved</option>
              <option value="WAIVED">Explicitly waived</option>
            </select>
          </Field>
          <Button disabled={busy}>Record decision</Button>
        </form>
      ) : (
        <p>{q.resolution || "Awaiting a project owner or team lead."}</p>
      )}
    </article>
  );
}
function ContractDetail({ contract: c, state, lead, busy, onClose, onAction, feedback }) {
  const [confirm, setConfirm] = useState(false),
    [reason, setReason] = useState("");
  const deps =
      state.analysis?.dependencies.filter((d) => d.interfaceId === c.id) || [],
    impact = state.impacts.find((i) => i.interfaceId === c.id),
    comparison = state.comparisons.find(
      (x) => x.id === c.id && x.version === c.version,
    )?.result;
  return (
    <Sheet title={c.id + " · " + c.version} onClose={onClose}>
      {feedback}
      <div className="flex gap-2">
        <Status good={c.status === "APPROVED"}>{c.status}</Status>
        <Status>{c.origin}</Status>
      </div>
      <p className="mesh-help">
        Provider: {c.providerStory}
        <br />
        Consumers: {deps.map((d) => d.consumer).join(", ") || "None recorded"}
        <br />
        Content hash: <code className="break-all">{c.hash}</code>
      </p>
      <details className="mesh-help">
        <summary>Dependency evidence and review status</summary>
        {deps.map((d) => (
          <div key={d.id}>
            <strong>
              {d.id} · {d.review}
            </strong>
            {d.evidence.map((e, i) => (
              <p key={i}>
                {e.quote}
                <br />
                <small>
                  {e.source}:{e.line}
                </small>
              </p>
            ))}
          </div>
        ))}
      </details>
      {c.errors.map((e) => (
        <div className="work-error" key={e}>
          {e}
        </div>
      ))}
      {comparison && (
        <div className="mesh-help">
          <strong>{comparison.status}</strong>
          <p>{comparison.coverage}</p>
          {comparison.findings.map((f, i) => (
            <p key={i}>
              {f.severity}: {f.path} — {f.message}
            </p>
          ))}
          <p>
            Affected:{" "}
            {impact?.stories
              .map((s) => s.id + (s.assignee ? " (" + s.assignee + ")" : ""))
              .join(", ") || "No recorded consumers"}
          </p>
        </div>
      )}
      {state.analysis?.decisions
        .filter(
          (q) =>
            q.status === "OPEN" &&
            q.critical &&
            (q.interfaceIds.includes(c.id) ||
              q.storyIds.includes(c.providerStory) ||
              deps.some((d) => q.storyIds.includes(d.consumer))),
        )
        .map((q) => (
          <div className="work-error" key={q.id}>
            {q.id}: {q.question}
          </div>
        ))}
      <h3 className="font-semibold mb-3">Review the exact specification</h3>
      <pre className="mesh-code">{JSON.stringify(c.document, null, 2)}</pre>
      <Button
        className="mt-3"
        size="sm"
        onClick={() => download(c.id + "-" + c.version + ".json", c.document)}
      >
        <Download size={14} />
        Download definition
      </Button>
      {lead && c.status === "VALIDATED" && (
        <div className="grid gap-4 mt-6">
          <Field label="Review rationale / migration plan">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={4000}
              rows={3}
            />
          </Field>
          <label className="flex gap-3 text-sm">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            I reviewed this exact version, its consumers, decisions, and
            changes.
          </label>
          <Button
            disabled={busy || !confirm || !reason.trim()}
            onClick={() =>
              onAction("approve", {
                confirmed: true,
                hash: c.hash,
                rationale: reason,
              })
            }
          >
            Approve immutable version
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => onAction("reject", {})}
          >
            Reject draft
          </Button>
        </div>
      )}
      {c.status === "APPROVED" && (
        <p className="mesh-help">
          Approved by account {c.reviewer} at {c.approvedAt}. {c.rationale}
        </p>
      )}
    </Sheet>
  );
}
function Exchange({ state, lead, busy, run, url, onProposal }) {
  const [pack, setPack] = useState(null),
    [confirmed, setConfirmed] = useState(false);
  return (
    <div className="mesh-exchange">
      <section>
        <h2>Analyze on your computer</h2>
        <p>
          Download the exact source bundle, inspect it, and explicitly run your
          own authenticated Codex. No shared AI account is used.
        </p>
        <Button
          onClick={() =>
            run(async () =>
              download("specmesh-context.json", await api(url + "/context")),
            )
          }
        >
          <Download size={15} />
          Download source bundle
        </Button>
        <pre className="mesh-code">
          npm run specmesh -- doctor{`\n`}npm run specmesh -- analyze --root
          ./analysis --context ./specmesh-context.json --provider codex
          --allow-ai --output proposal.json
        </pre>
        <p className="text-sm text-mutedForeground">
          Add <code>--model MODEL_NAME</code> using a model available in your
          Codex account, or set <code>SPECMESH_CODEX_MODEL</code>. Isolated
          analysis does not inherit your normal model setting. If that model
          requires a newer CLI, update Codex or set <code>SPECMESH_CODEX_PATH</code>
          {" "}to a compatible installed executable.
        </p>
        <p className="text-sm text-mutedForeground">
          The app uses the official CLI fallback with user configuration
          disabled, no shell tool, read-only execution, a structured output
          schema, and a timeout. Authentication stays managed by Codex.
          Enterprise policy still controls access.
        </p>
      </section>
      <section>
        <h2>Bring proposals back for review</h2>
        <p>
          Upload a proposal from the same source fingerprint. Uploaded findings
          cannot approve dependencies, decisions, or contracts.
        </p>
        {lead ? (
          <>
            <input
              aria-label="Choose analysis proposal"
              type="file"
              accept=".json"
              onChange={(e) => {
                const f = e.target.files[0];
                e.target.value = "";
                setPack(null);
                setConfirmed(false);
                if (f)
                  void run(async () => {
                    if (f.size > 2_000_000)
                      throw Error("Proposal exceeds 2 MB.");
                    setPack(JSON.parse(await f.text()));
                  });
              }}
            />
            {pack && (
              <>
                <pre className="mesh-code">{JSON.stringify(pack, null, 2)}</pre>
                <label className="flex gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I reviewed this proposal for this project.
                </label>
                <Button
                  className="mt-4"
                  disabled={busy || !confirmed}
                  onClick={() =>
                    run(async () => {
                      await onProposal(pack);
                      setPack(null);
                      setConfirmed(false);
                    }, "Proposal imported for human review.")
                  }
                >
                  Import proposal
                </Button>
              </>
            )}
          </>
        ) : (
          <p>A team lead imports proposals into this shared project.</p>
        )}
      </section>
      <section>
        <h2>Take approved contracts into development</h2>
        <p>
          The registry includes project sources and approval records. Keep it
          within the authorized project team. Imported files never overwrite an
          existing local registry.
        </p>
        <Button
          onClick={() =>
            run(async () =>
              download("specmesh-registry.json", await api(url + "/registry")),
            )
          }
        >
          <Download size={15} />
          Download registry
        </Button>
        <pre className="mesh-code">
          npm run specmesh -- registry import ./specmesh-registry.json --root
          ./project{`\n`}npm run specmesh -- workspace US-3 --root ./project
          {`\n`}npm run specmesh -- verify --root ./project
        </pre>
        <p>
          Commit .specmesh/contracts/approved and the registry state through
          your normal Git review. Generated manifests complement your Spec Kit
          or Davaflow planning inputs; no proprietary integration or extension
          is claimed.
        </p>
      </section>
    </div>
  );
}
function DependencyMap({ state, lead, busy, onReview }) {
  const [type, setType] = useState("ALL"),
    [selected, setSelected] = useState(""),
    [direction, setDirection] = useState("all");
  const all = state.analysis?.dependencies || [],
    deps = all.filter(
      (d) => d.review !== "REJECTED" && (type === "ALL" || d.type === type),
    );
  const focused = useMemo(() => {
    if (!selected || direction === "all") return null;
    const found = new Set([selected]),
      queue = [selected];
    for (let i = 0; i < queue.length; i++)
      for (const d of deps) {
        const source = direction === "upstream" ? d.consumer : d.provider,
          target = direction === "upstream" ? d.provider : d.consumer;
        if (source === queue[i] && !found.has(target)) {
          found.add(target);
          queue.push(target);
        }
      }
    return found;
  }, [selected, direction, deps]);
  const interfaces = [
    ...new Set(deps.map((d) => d.interfaceId).filter(Boolean)),
  ];
  const nodes = [
    ...state.stories.map((s, i) => ({
      id: s.id,
      position: { x: 0, y: i * 115 },
      data: {
        label: (
          <div>
            <small>{s.id}</small>
            <strong>{s.title}</strong>
            <small>{s.assignee || "Unassigned"}</small>
          </div>
        ),
      },
      className: "mesh-graph-story",
      style: { opacity: focused && !focused.has(s.id) ? 0.25 : 1 },
    })),
    ...interfaces.map((id, i) => ({
      id: "interface:" + id,
      position: { x: 390, y: i * 120 + 40 },
      data: {
        label: (
          <div>
            <small>INTERFACE</small>
            <strong>{id}</strong>
          </div>
        ),
      },
      className: "mesh-graph-interface",
    })),
  ];
  const edges = deps.flatMap((d) => {
    const style = {
        stroke: d.review === "CONFIRMED" ? "#518368" : "#bd8944",
        strokeDasharray: d.review === "CONFIRMED" ? "0" : "5 4",
      },
      markerEnd = { type: MarkerType.ArrowClosed };
    return d.interfaceId
      ? [
          {
            id: d.id + "-p",
            source: d.provider,
            target: "interface:" + d.interfaceId,
            style,
            markerEnd,
            label: "provides",
          },
          {
            id: d.id + "-c",
            source: "interface:" + d.interfaceId,
            target: d.consumer,
            style,
            markerEnd,
            label: d.type,
          },
        ]
      : [
          {
            id: d.id,
            source: d.provider,
            target: d.consumer,
            style,
            markerEnd,
            label: d.type,
          },
        ];
  });
  return (
    <>
      <div className="mesh-section-heading">
        <div>
          <h2>Trace what each story needs</h2>
          <p>
            Solid lines are confirmed. Dashed lines still need review. Select a
            node to inspect evidence.
          </p>
        </div>
      </div>
      <div className="mesh-graph-controls">
        <select
          aria-label="Dependency type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {["ALL", "API", "DATA", "EVENT", "BUSINESS", "IMPLEMENTATION"].map(
            (t) => (
              <option key={t}>{t}</option>
            ),
          )}
        </select>
        <select
          aria-label="Trace direction"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
        >
          <option value="all">All relationships</option>
          <option value="upstream">Highlight upstream</option>
          <option value="downstream">Highlight downstream</option>
        </select>
        <Button size="sm" onClick={() => setSelected("")}>
          Clear selection
        </Button>
      </div>
      <div className="mesh-graph">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          onNodeClick={(_, n) => setSelected(n.id)}
        >
          <Background gap={25} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {state.cycles.length > 0 && (
        <div className="work-error">
          Dependency cycles: {state.cycles.map((c) => c.join(" → ")).join("; ")}
        </div>
      )}
      <div className="mesh-dependencies">
        {all
          .filter(
            (d) =>
              !selected ||
              d.provider === selected ||
              d.consumer === selected ||
              "interface:" + d.interfaceId === selected,
          )
          .map((d) => (
            <article key={d.id}>
              <div className="flex flex-wrap gap-2">
                <Status>{d.type}</Status>
                <Status good={d.review === "CONFIRMED"}>{d.review}</Status>
                <Status>{d.classification}</Status>
              </div>
              <h3>
                {d.provider} → {d.consumer}
              </h3>
              <p>
                {d.interfaceId} · {d.reason}
              </p>
              {d.evidence.map((e, i) => (
                <blockquote key={i}>
                  {e.quote}
                  <small>
                    {e.source}:{e.line}
                  </small>
                </blockquote>
              ))}
              {lead && d.review !== "REJECTED" && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy || !state.analysisCurrent || d.review==='CONFIRMED'}
                    onClick={() => onReview(d.id, true)}
                  >
                    Confirm dependency
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !state.analysisCurrent}
                    onClick={() => onReview(d.id, false)}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </article>
          ))}
      </div>
      {!all.length && (
        <div className="work-empty">
          <h3>No dependencies analyzed</h3>
          <p>
            Download the context from Exchange and analyze it locally. Manual
            structured proposals use the same review process.
          </p>
        </div>
      )}
    </>
  );
}
