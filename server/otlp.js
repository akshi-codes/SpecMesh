import { getDb, insertTurn, upsertProject, upsertThread } from "./db.js";
import { projectFromPath, stableId } from "./util.js";
import { normalizeUsage } from "./importer.js";
import { retentionCutoff } from "./preferences.js";

const attributes = (values) =>
  Object.fromEntries(
    (Array.isArray(values) ? values : []).map((a) => [
      a.key,
      a.value?.stringValue ??
        a.value?.intValue ??
        a.value?.doubleValue ??
        a.value?.boolValue,
    ]),
  );
export function ingestOtlpLogs(body) {
  const records = [
    ...(Array.isArray(body) ? body : []),
    ...(Array.isArray(body.logRecords) ? body.logRecords : []),
  ];
  for (const resource of body.resourceLogs || [])
    for (const scope of resource.scopeLogs || [])
      for (const r of scope.logRecords || [])
        records.push({
          ...r,
          resourceAttrs: attributes(resource.resource?.attributes),
        });
  let imported = 0,
    skipped = 0,
    invalid = 0;
  const db = getDb();
  for (const record of records) {
    try {
      const a = {
        ...record.resourceAttrs,
        ...attributes(record.attributes),
        ...attributes(record.body?.kvlistValue?.values),
      };
      if (
        !String(
          a["event.name"] || a.event_name || record.name || "",
        ).startsWith("codex.")
      ) {
        skipped++;
        continue;
      }
      const occurredAt = new Date(
        Number(BigInt(record.timeUnixNano) / 1000000n),
      ).toISOString();
      if (occurredAt < retentionCutoff()) {
        skipped++;
        continue;
      }
      const threadId = a.conversation_id || a["conversation.id"] || a.thread_id;
      if (!threadId) {
        invalid++;
        continue;
      }
      const u = normalizeUsage({
        input_tokens: a.input_tokens ?? a["usage.input_tokens"],
        cached_input_tokens:
          a.cached_input_tokens ?? a["usage.cached_input_tokens"],
        output_tokens: a.output_tokens ?? a["usage.output_tokens"],
        reasoning_output_tokens:
          a.reasoning_output_tokens ?? a["usage.reasoning_output_tokens"],
        total_tokens: a.total_tokens,
      });
      if (!u.total_tokens) {
        skipped++;
        continue;
      }
      const project = projectFromPath(
        a.cwd || a.project_path || "Unknown project",
      );
      db.exec("SAVEPOINT otlp_record");
      try {
        upsertProject(db, {
          ...project,
          firstSeen: occurredAt,
          lastSeen: occurredAt,
        });
        if (
          !db.prepare("SELECT id FROM threads WHERE id=?").get(String(threadId))
        )
          upsertThread(db, {
            id: String(threadId),
            projectId: project.id,
            title: `${project.name} / ${String(threadId).slice(0, 8)}`,
            source: "codex-otel",
            model: a.model ?? null,
            status: "observed",
            startedAt: occurredAt,
            endedAt: occurredAt,
            lastSeen: occurredAt,
          });
        const result = insertTurn(db, {
          id: stableId(`otlp:${threadId}:${occurredAt}:${JSON.stringify(u)}`),
          threadId: String(threadId),
          projectId: project.id,
          occurredAt,
          source: "codex-otel",
          model: a.model ?? null,
          inputTokens: u.input_tokens,
          cachedInputTokens: u.cached_input_tokens,
          outputTokens: u.output_tokens,
          reasoningOutputTokens: u.reasoning_output_tokens,
          sourceTotal: u.total_tokens,
          toolEvents: 0,
          errorEvents: 0,
          durationMs: null,
          rawUsageHash: stableId(JSON.stringify(u)),
        });
        if (result.changes) imported++;
        else skipped++;
        db.exec("RELEASE otlp_record");
      } catch (error) {
        db.exec("ROLLBACK TO otlp_record; RELEASE otlp_record");
        throw error;
      }
    } catch {
      invalid++;
    }
  }
  return { imported, skipped, invalid };
}
