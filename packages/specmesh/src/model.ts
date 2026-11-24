import { z } from "zod";
import { createHash } from "node:crypto";

export const hash = (value: unknown): string =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/);
const text = z.string().max(100000);
export const Source = z
  .object({ path: z.string().min(1).max(300), content: text, hash: z.string() })
  .strict();
export const Evidence = z
  .object({
    source: z.string(),
    line: z.number().int().positive(),
    quote: z.string().min(1).max(2000),
  })
  .strict();
export const Story = z
  .object({
    id,
    title: z.string().min(1).max(300),
    description: text,
    acceptance: z.array(text),
    source: z.string(),
    line: z.number().int().positive(),
    sourceHash: z.string(),
    assignee: z.string().max(120).default(""),
    service: z.string().max(120).default(""),
  })
  .strict();
export const Dependency = z
  .object({
    id,
    consumer: id,
    provider: id,
    type: z.enum(["API", "DATA", "EVENT", "BUSINESS", "IMPLEMENTATION"]),
    interfaceId: z.string().max(120),
    reason: z.string().max(4000),
    evidence: z.array(Evidence).min(1).max(20),
    classification: z.enum([
      "EXPLICIT",
      "INFERRED",
      "CONFIRMED",
      "UNRESOLVED",
      "REJECTED",
    ]),
    review: z
      .enum(["REVIEW_REQUIRED", "CONFIRMED", "REJECTED"])
      .default("REVIEW_REQUIRED"),
  })
  .strict();
export const Decision = z
  .object({
    id,
    question: z.string().min(1).max(4000),
    storyIds: z.array(id),
    interfaceIds: z.array(id),
    critical: z.boolean(),
    status: z.enum(["OPEN", "RESOLVED", "WAIVED"]),
    resolution: z.string().max(4000).default(""),
    reviewer: z.string().default(""),
    evidence: z.array(Evidence).max(20),
  })
  .strict();
export const Analysis = z
  .object({
    sourceHash: z.string(),
    provider: z.enum(["codex", "demo", "manual"]),
    dependencies: z.array(Dependency).max(1000),
    decisions: z.array(Decision).max(300),
    createdAt: z.string(),
  })
  .strict();
export const Proposal = z
  .object({
    dependencies: z.array(Dependency).max(1000),
    decisions: z.array(Decision).max(300),
  })
  .strict();
export const Contract = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    providerStory: id,
    document: z.record(z.string(), z.unknown()),
    hash: z.string(),
    sourceHash: z.string(),
    status: z.enum(["DRAFT", "VALIDATED", "APPROVED", "REJECTED"]),
    errors: z.array(z.string()),
    reviewer: z.string(),
    approvedAt: z.string(),
    rationale: z.string(),
    origin: z.enum(["manual", "codex", "demo"]),
  })
  .strict();
export const State = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    project: z
      .object({
        id,
        name: z.string().min(1).max(120),
        ownerId: z.string(),
        teamId: z.string(),
        demo: z.boolean(),
        createdAt: z.string(),
      })
      .strict(),
    sources: z.array(Source).max(200),
    stories: z.array(Story).max(500),
    analysis: Analysis.nullable(),
    contracts: z.array(Contract).max(1000),
    audit: z
      .array(
        z
          .object({
            at: z.string(),
            actor: z.string(),
            action: z.string(),
            target: z.string(),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();
export type ProjectState = z.infer<typeof State>;
export type StoryRecord = z.infer<typeof Story>;
export type DependencyRecord = z.infer<typeof Dependency>;
export type ContractRecord = z.infer<typeof Contract>;
export const sourceHash = (state: ProjectState) =>
  hash(
    state.sources
      .map((s) => [s.path, s.hash])
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
export function fail(message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}
export function evidenceValid(
  state: ProjectState,
  items: z.infer<typeof Evidence>[],
) {
  for (const evidence of items) {
    const source = state.sources.find((s) => s.path === evidence.source);
    if (
      !source ||
      !source.content
        .split(/\r?\n/)
        [evidence.line - 1]?.includes(evidence.quote)
    )
      fail(
        `Evidence does not match source: ${evidence.source}:${evidence.line}`,
      );
  }
}
