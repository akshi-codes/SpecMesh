import { z } from "zod";
import { FileStore } from "./store.ts";
import { importDocuments } from "./importer.ts";
import {
  Analysis,
  Proposal,
  Contract,
  sourceHash,
  evidenceValid,
  hash,
  fail,
  id,
} from "./model.ts";
import type { ProjectState, ContractRecord } from "./model.ts";
import { validateDocument, compareContracts } from "./contracts.ts";

export { FileStore, importDocuments, validateDocument, compareContracts };
export function currentAnalysis(s: ProjectState) {
  return !!s.analysis && s.analysis.sourceHash === sourceHash(s);
}
export function applyAnalysis(
  s: ProjectState,
  raw: unknown,
  provider: "codex" | "demo" | "manual",
): ProjectState {
  const p = Proposal.parse(raw),
    known = new Set(s.stories.map((t) => t.id)),
    seen = new Set<string>();
  for (const previous of s.analysis?.dependencies || [])
    if (previous.review === "CONFIRMED" && !p.dependencies.some(d => d.id === previous.id))
      fail(`Retain confirmed dependency ${previous.id} for explicit human review; proposals cannot silently remove it.`);
  for (const previous of s.analysis?.decisions || [])
    if (previous.critical && !p.decisions.some(q => q.id === previous.id))
      fail(`Retain critical decision ${previous.id}; proposals cannot silently remove it.`);
  for (const d of p.dependencies) {
    if (seen.has(d.id)) fail("Duplicate dependency ID.");
    seen.add(d.id);
    if (
      !known.has(d.provider) ||
      !known.has(d.consumer) ||
      d.provider === d.consumer
    )
      fail("Dependency refers to an invalid story.");
    if (d.interfaceId) {
      id.parse(d.interfaceId);
      if (d.type === "API" && !Contract.shape.id.safeParse(d.interfaceId).success)
        fail("API interface IDs must use letters, numbers, dots, underscores, or hyphens so approved contracts can be exported.");
    }
    if (d.type === "API" && !d.interfaceId)
      fail("API dependencies need a canonical interface ID.");
    evidenceValid(s, d.evidence);
    const previous = s.analysis?.dependencies.find(old => old.id === d.id && old.review === "CONFIRMED");
    if (previous && (["provider", "consumer", "type", "interfaceId"] as const).some(key => previous[key] !== d[key]))
      fail(`Reject confirmed dependency ${d.id} explicitly before replacing its relationship. Use a new ID for the new relationship.`);
    d.review = "REVIEW_REQUIRED";
    d.classification =
      d.classification === "EXPLICIT" ? "EXPLICIT" : "INFERRED";
  }
  seen.clear();
  for (const q of p.decisions) {
    if (seen.has(q.id)) fail("Duplicate decision ID.");
    seen.add(q.id);
    if (q.storyIds.some((k) => !known.has(k)))
      fail("Decision refers to an unknown story.");
    evidenceValid(s, q.evidence);
    q.status = "OPEN";
    q.resolution = "";
    q.reviewer = "";
    const previous = s.analysis?.decisions.find(old => old.id === q.id);
    if (previous?.critical && (
      previous.question !== q.question ||
      previous.storyIds.some(id => !q.storyIds.includes(id)) ||
      previous.interfaceIds.some(id => !q.interfaceIds.includes(id))
    )) fail(`Retain the scope of critical decision ${q.id}; add a new question instead of rewriting the reviewed question.`);
    if (previous?.critical) q.critical = true;
    if (
      previous && currentAnalysis(s) &&
      previous.question === q.question &&
      hash(previous.evidence) === hash(q.evidence) &&
      previous.critical === q.critical &&
      hash([...previous.storyIds].sort()) === hash([...q.storyIds].sort()) &&
      hash([...previous.interfaceIds].sort()) === hash([...q.interfaceIds].sort()) &&
      previous.status !== "OPEN"
    ) {
      q.status = previous.status;
      q.resolution = previous.resolution;
      q.reviewer = previous.reviewer;
    }
  }
  const providers = new Map<string, string>();
  for (const d of p.dependencies)
    if (d.interfaceId) {
      const provider = providers.get(d.interfaceId);
      if (provider && provider !== d.provider)
        fail(
          `Conflicting providers for ${d.interfaceId}. Resolve ownership first.`,
        );
      providers.set(d.interfaceId, d.provider);
      if (
        s.contracts.some(
          (c) => c.id === d.interfaceId && c.providerStory !== d.provider,
        )
      )
        fail(`Interface ${d.interfaceId} already belongs to another provider.`);
    }
  return {
    ...s,
    analysis: Analysis.parse({
      ...p,
      sourceHash: sourceHash(s),
      provider,
      createdAt: new Date().toISOString(),
    }),
  };
}
export function impact(s: ProjectState, interfaceId: string) {
  const edges =
    s.analysis?.dependencies.filter((d) => d.review !== "REJECTED") || [];
  const direct = [
    ...new Set(
      edges.filter((d) => d.interfaceId === interfaceId).map((d) => d.consumer),
    ),
  ];
  const affected = new Set(direct),
    queue = [...direct];
  for (let i = 0; i < queue.length; i++)
    for (const d of edges)
      if (d.provider === queue[i] && !affected.has(d.consumer)) {
        affected.add(d.consumer);
        queue.push(d.consumer);
      }
  return {
    interfaceId,
    direct,
    transitive: [...affected].filter((x) => !direct.includes(x)),
    stories: s.stories
      .filter((t) => affected.has(t.id))
      .map((t) => ({
        id: t.id,
        title: t.title,
        assignee: t.assignee,
        service: t.service,
      })),
  };
}
export function cycles(s: ProjectState) {
  const edges =
      s.analysis?.dependencies.filter((d) => d.review !== "REJECTED") || [],
    result: string[][] = [],
    seen = new Set<string>(),
    active: string[] = [];
  function visit(n: string) {
    const at = active.indexOf(n);
    if (at >= 0) {
      result.push([...active.slice(at), n]);
      return;
    }
    if (seen.has(n)) return;
    active.push(n);
    for (const d of edges.filter((e) => e.provider === n)) visit(d.consumer);
    active.pop();
    seen.add(n);
  }
  for (const story of s.stories) visit(story.id);
  return result;
}
export function latestApproved(
  s: ProjectState,
  key: string,
): ContractRecord | undefined {
  return s.contracts
    .filter((c) => c.id === key && c.status === "APPROVED")
    .sort((a, b) => {
      const x = a.version.split(".").map(Number),
        y = b.version.split(".").map(Number);
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    })[0];
}
export function manifest(
  s: ProjectState,
  storyId: string,
  availableMocks: string[] = [],
) {
  const story = s.stories.find((t) => t.id === storyId);
  if (!story) fail("Story not found.", 404);
  const deps = (s.analysis?.dependencies || []).filter(
    (d) =>
      (d.consumer === storyId || d.provider === storyId) &&
      d.review !== "REJECTED",
  );
  const interfaceIds = [
      ...new Set(
        deps
          .filter((d) => d.type === "API")
          .map((d) => d.interfaceId)
          .filter(Boolean),
      ),
    ],
    contracts = interfaceIds.map((key) => latestApproved(s, key));
  const blockers: string[] = [];
  const developmentBlockers: string[] = [];
  if (!currentAnalysis(s)) blockers.push("Analyze the current sources.");
  for (const d of deps) {
    if (d.review !== "CONFIRMED") blockers.push(`Review dependency ${d.id}.`);
    if (d.type !== "API" && d.consumer === storyId)
      developmentBlockers.push(
        `Confirm ${d.type.toLowerCase()} development input for ${d.id} outside this MVP.`,
      );
  }
  for (let i = 0; i < interfaceIds.length; i++) {
    const c = contracts[i];
    if (!c || c.sourceHash !== sourceHash(s))
      blockers.push(`Approve ${interfaceIds[i]} against current sources.`);
  }
  for (const q of s.analysis?.decisions || [])
    if (
      q.critical &&
      q.status === "OPEN" &&
      (q.storyIds.includes(storyId) ||
        q.interfaceIds.some((x) => interfaceIds.includes(x)))
    )
      blockers.push(`Resolve decision ${q.id}.`);
  if (cycles(s).some((c) => c.includes(storyId)))
    blockers.push("Review the dependency cycle.");
  const consumed = deps
    .filter((d) => d.consumer === storyId && d.type === "API")
    .map((d) => d.interfaceId);
  const contractReady = blockers.length === 0,
    missingMocks = consumed.filter((key) => {
      const c = latestApproved(s, key);
      return !c || !availableMocks.includes(`${key}@${c.version}`);
    });
  return {
    story,
    sourceHash: sourceHash(s),
    provided: interfaceIds.filter((key) =>
      deps.some((d) => d.interfaceId === key && d.provider === storyId),
    ),
    consumed,
    contracts: contracts.filter(Boolean).map((c) => ({
      id: c!.id,
      version: c!.version,
      hash: c!.hash,
      path: `.specmesh/contracts/approved/${c!.id}/${c!.version}.json`,
    })),
    blockers,
    developmentBlockers,
    nonHttpDependencies: deps.filter((d) => d.type !== "API"),
    missingMocks,
    contractReady,
    developmentReady:
      contractReady && !missingMocks.length && !developmentBlockers.length,
    implementationVerified: false,
    integrationReady: false,
    instructions:
      "Use the pinned contracts. Do not invent or change shared interfaces. Propose a new version and obtain human review. Mock availability is simulated behavior, never real integration evidence.",
  };
}
export class SpecMesh {
  store: FileStore;
  constructor(root: string) {
    this.store = new FileStore(root);
  }
  read() {
    return this.store.read();
  }
  import(files: { path: string; content: string }[], actor: string) {
    const s = this.read();
    return this.store.save(
      importDocuments(s, files),
      s.revision,
      actor,
      "import-sources",
    );
  }
  analyze(
    raw: unknown,
    provider: "codex" | "demo" | "manual",
    expectedHash: string,
    actor: string,
  ) {
    const s = this.read();
    if (expectedHash !== sourceHash(s))
      fail("Proposal is stale. Analyze the current source bundle.", 409);
    return this.store.save(
      applyAnalysis(s, raw, provider),
      s.revision,
      actor,
      "analyze",
    );
  }
  reviewDependency(key: string, confirmed: boolean, actor: string) {
    const s = this.read();
    if (!currentAnalysis(s)) fail("Analysis is stale.");
    const d = s.analysis!.dependencies.find((d) => d.id === key);
    if (!d) fail("Dependency not found.", 404);
    d.review = confirmed ? "CONFIRMED" : "REJECTED";
    d.classification = confirmed ? "CONFIRMED" : "REJECTED";
    return this.store.save(s, s.revision, actor, "review-dependency", key);
  }
  decide(
    key: string,
    status: "RESOLVED" | "WAIVED",
    resolution: string,
    actor: string,
  ) {
    const s = this.read();
    if (!currentAnalysis(s)) fail("Analysis is stale.");
    const q = s.analysis!.decisions.find((q) => q.id === key);
    if (!q) fail("Decision not found.", 404);
    if (
      !["RESOLVED", "WAIVED"].includes(status) ||
      typeof resolution !== "string" ||
      !resolution.trim() ||
      resolution.length > 4000
    )
      fail("Record a decision rationale.");
    q.status = status;
    q.resolution = resolution;
    q.reviewer = actor;
    return this.store.save(s, s.revision, actor, "resolve-decision", key);
  }
  assign(storyId: string, assignee: string, service: string, actor: string) {
    const s = this.read();
    const story = s.stories.find((t) => t.id === storyId);
    if (!story) fail("Story not found.", 404);
    story.assignee = z.string().max(120).parse(assignee);
    story.service = z.string().max(120).parse(service);
    return this.store.save(s, s.revision, actor, "assign-story", storyId);
  }
  async draft(
    input: {
      id: string;
      version: string;
      providerStory: string;
      document: unknown;
      origin?: "manual" | "codex" | "demo";
    },
    actor: string,
  ) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      fail("Provide a contract ID, version, provider story, and OpenAPI document.");
    const s = this.read(),
      result = await validateDocument(input.document);
    if (!s.stories.some((t) => t.id === input.providerStory))
      fail("Select an existing provider story.");
    if (
      s.contracts.some((c) => c.id === input.id && c.version === input.version)
    )
      fail("This version already exists. Create a new version.", 409);
    if (
      s.contracts.some(
        (c) => c.id === input.id && c.providerStory !== input.providerStory,
      )
    )
      fail("An interface already has a different provider.");
    if (
      s.analysis?.dependencies.some(
        (d) =>
          d.interfaceId === input.id &&
          d.provider !== input.providerStory &&
          d.review !== "REJECTED",
      )
    )
      fail("Provider conflicts with the dependency graph.");
    if (result.document.info?.version !== input.version)
      fail("OpenAPI info.version must match the proposed version.");
    const c = Contract.parse({
      ...input,
      origin: input.origin || "manual",
      document: result.document,
      hash: hash(result.document),
      sourceHash: sourceHash(s),
      status: result.errors.length ? "DRAFT" : "VALIDATED",
      errors: result.errors,
      reviewer: "",
      approvedAt: "",
      rationale: "",
    });
    s.contracts.push(c);
    return this.store.save(
      s,
      s.revision,
      actor,
      "draft-contract",
      c.id + "@" + c.version,
    );
  }
  async approve(
    key: string,
    version: string,
    expectedHash: string,
    rationale: string,
    actor: string,
  ) {
    if (typeof actor !== "string" || typeof rationale !== "string" || !actor.trim() || !rationale.trim() || rationale.length > 4000)
      fail("A human reviewer and rationale are required.");
    const s = this.read(),
      c = s.contracts.find((c) => c.id === key && c.version === version);
    if (!c || c.status !== "VALIDATED" || c.hash !== expectedHash || hash(c.document) !== c.hash)
      fail("Review the exact validated draft before approving.", 409);
    if (!currentAnalysis(s) || c.sourceHash !== sourceHash(s))
      fail(
        "Sources or analysis changed. Create a fresh draft before approval.",
      );
    const related = s.analysis!.dependencies.filter(
      (d) => d.interfaceId === key && d.review !== "REJECTED",
    );
    if (related.some((d) => d.review !== "CONFIRMED"))
      fail("Review all interface dependencies first.");
    if (
      s.analysis!.decisions.some(
        (q) =>
          q.status === "OPEN" &&
          q.critical &&
          (q.interfaceIds.includes(key) ||
            q.storyIds.includes(c.providerStory) ||
            related.some((d) => q.storyIds.includes(d.consumer))),
      )
    )
      fail("Resolve or explicitly waive critical decisions before approval.");
    const validation = await validateDocument(c.document);
    if (validation.errors.length) fail(validation.errors.join("\n"));
    const prior = latestApproved(s, key);
    if (prior) {
      const versions = [prior.version, c.version].map((v) =>
        v.split(".").map(Number),
      );
      const [a, b] = versions;
      if (
        b[0] < a[0] ||
        (b[0] === a[0] && b[1] < a[1]) ||
        (b[0] === a[0] && b[1] === a[1] && b[2] <= a[2])
      )
        fail("Publish a higher semantic version.");
      if (
        compareContracts(prior.document, c.document).status === "BREAKING" &&
        b[0] <= a[0]
      )
        fail("A breaking contract change requires a major version increase.");
    }
    c.status = "APPROVED";
    c.reviewer = actor;
    c.approvedAt = new Date().toISOString();
    c.rationale = rationale;
    return this.store.save(
      s,
      s.revision,
      actor,
      "approve-contract",
      key + "@" + version,
      c,
    );
  }
  reject(key: string, version: string, actor: string) {
    const s = this.read(),
      c = s.contracts.find((c) => c.id === key && c.version === version);
    if (!c || c.status === "APPROVED")
      fail("Approved snapshots are immutable.");
    c.status = "REJECTED";
    return this.store.save(
      s,
      s.revision,
      actor,
      "reject-contract",
      key + "@" + version,
    );
  }
  async verify() {
    const s = this.read(),
      errors: string[] = [];
    if (!currentAnalysis(s)) errors.push("Missing or stale analysis.");
    for (const c of s.contracts.filter((c) => c.status === "APPROVED")) {
      if (!this.store.verifySnapshot(c))
        errors.push(`Snapshot mismatch: ${c.id}@${c.version}`);
      if ((await validateDocument(c.document)).errors.length)
        errors.push(`Invalid approved contract: ${c.id}`);
    }
    for (const t of s.stories)
      errors.push(...manifest(s, t.id).blockers.map((b) => `${t.id}: ${b}`));
    for (const c of s.contracts.filter((c) => c.status === "VALIDATED")) {
      const prior = latestApproved(s, c.id);
      if (
        prior &&
        compareContracts(prior.document, c.document).status !== "UNCHANGED"
      )
        errors.push(`Pending contract change: ${c.id}@${c.version}`);
    }
    return {
      ok: errors.length === 0,
      errors: [...new Set(errors)],
      implementationVerified: false,
      integrationReady: false,
      checkedAt: new Date().toISOString(),
    };
  }
}
