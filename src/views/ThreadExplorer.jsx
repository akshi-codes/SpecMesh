import { useEffect, useRef, useState } from "react";
import { Bookmark } from "lucide-react";
import { Sheet, Field } from "../components/Interactions.jsx";
import { Button } from "../components/ui.jsx";
import { api, formatCompact } from "../lib/api.js";
export function ThreadExplorer({ id, queryString, revision, onClose, onSave }) {
  const initialized = useRef(false);
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [saveError, setSaveError] = useState(""),
    [label, setLabel] = useState(""),
    [tags, setTags] = useState(""),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    api(`/api/threads/${encodeURIComponent(id)}?${queryString}`, {
      signal: ctrl.signal,
    })
      .then((d) => {
        setData(d);
        setError("");
        if (!initialized.current) {
          setLabel(d.annotation.label);
          setTags(d.annotation.tags.join(", "));
          setSaved(d.annotation.bookmarked);
          initialized.current = true;
        }
      })
      .catch((e) => {
        if (!e.cancelled) setError(e.message);
      });
    return () => ctrl.abort();
  }, [id, queryString, revision]);
  const max = (data?.turns || []).reduce(
    (max, t) => Math.max(max, t.tokens),
    1,
  );
  return (
    <Sheet
      title={data?.annotation.label || "Thread explorer"}
      onClose={onClose}
    >
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : !data ? (
        <p>Loading thread…</p>
      ) : (
        <>
          <p className="break-all font-mono text-xs text-mutedForeground">
            {id}
          </p>
          <div className="metric-strip">
            <div>
              <small>Total tokens</small>
              <p className="text-2xl font-semibold">
                {formatCompact(data.totals.total_tokens)}
              </p>
            </div>
            <div>
              <small>Usage events</small>
              <p className="text-2xl font-semibold">{data.turns.length}</p>
            </div>
            <div>
              <small>Observed tool failures</small>
              <p className="text-2xl font-semibold">
                {data.totals.error_events}
              </p>
            </div>
          </div>
          <form
            className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await onSave({
                  label,
                  tags: tags
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                  bookmarked: saved,
                });
                setSaveError("");
                setData((d) => ({
                  ...d,
                  annotation: { ...d.annotation, label },
                }));
              } catch (e) {
                setSaveError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {saveError && (
              <p role="alert" className="text-sm text-danger sm:col-span-2">
                {saveError}
              </p>
            )}
            <Field label="Thread label">
              <input
                maxLength={120}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Give this work a recognizable name"
              />
            </Field>
            <Field label="Tags" hint="Comma separated; up to 12 tags.">
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="debugging, learning"
              />
            </Field>
            <Button
              type="button"
              variant="secondary"
              aria-pressed={saved}
              onClick={() => setSaved(!saved)}
            >
              <Bookmark size={15} fill={saved ? "currentColor" : "none"} />
              {saved ? "Bookmarked" : "Bookmark"}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save details"}
            </Button>
          </form>
          <div>
            <h3 className="text-lg font-semibold">Usage timeline</h3>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Each row is a reported usage event, which may be part of a longer
              turn. Cache and reasoning are included in input and output
              respectively. Prompt and reply text are excluded.
            </p>
          </div>
          {!data.turns.length && (
            <p className="text-sm text-mutedForeground">
              No events in this date range. Choose a wider period to inspect
              this thread.
            </p>
          )}
          <ol className="space-y-3">
            {data.turns.slice(page * 30, page * 30 + 30).map((t, i) => {
              const previous = data.turns[page * 30 + i - 1];
              return (
                <li
                  key={t.id}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex flex-wrap justify-between gap-2 text-xs text-mutedForeground">
                    <span>
                      {new Date(t.occurred_at).toLocaleString(undefined, {
                        timeZone: data.window.timezone,
                      })}{" "}
                      ({data.window.timezone})
                    </span>
                    <span>
                      {t.model || "Unknown model"}{" "}
                      {previous && previous.model !== t.model
                        ? " / Model changed"
                        : ""}
                    </span>
                  </div>
                  <div className="my-3 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full origin-left rounded-full bg-accent"
                        style={{ transform: `scaleX(${t.tokens / max})` }}
                      />
                    </div>
                    <strong className="font-mono text-sm">
                      {t.tokens.toLocaleString()}
                    </strong>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <span>Input {formatCompact(t.input_tokens)}</span>
                    <span>Cached {formatCompact(t.cached_input_tokens)}</span>
                    <span>Output {formatCompact(t.output_tokens)}</span>
                    <span>
                      Reasoning {formatCompact(t.reasoning_output_tokens)}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-mutedForeground">
                    {t.tool_events} observed tool calls; {t.error_events}{" "}
                    explicit failures
                    {t.duration_ms
                      ? `; ${t.duration_ms} ms reported duration`
                      : ""}
                  </p>
                </li>
              );
            })}
          </ol>
          {data.turns.length > 30 && (
            <div className="flex items-center justify-between">
              <Button
                size="sm"
                variant="secondary"
                disabled={!page}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <span className="text-xs">
                {page + 1} / {Math.ceil(data.turns.length / 30)}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={(page + 1) * 30 >= data.turns.length}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
