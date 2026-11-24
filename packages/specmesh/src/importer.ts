import fs from "node:fs";
import path from "node:path";
import { hash, fail, Story } from "./model.ts";
import type { ProjectState, StoryRecord } from "./model.ts";

export function safeSource(name: string) {
  if (typeof name !== "string" || name.length > 300)
    fail("Source path must be a relative file name of at most 300 characters.");
  const normalized = name.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes(":") ||
    normalized
      .split("/")
      .some((p) => !p || p === ".." || p === "." || p.startsWith(".")) ||
    /(?:auth|credential|secret|token|password|\.env)/i.test(normalized) ||
    !/\.(md|json|ya?ml)$/i.test(normalized)
  )
    fail(
      "Use relative Markdown/JSON/YAML source names without secret files or hidden directories.",
    );
  return normalized;
}
export function normalizeMarkdown(
  name: string,
  content: string,
): StoryRecord[] {
  const lines = content.split(/\r?\n/),
    starts: { index: number; id: string; title: string }[] = [];
  const prefix = name
    .replace(/\.md$/i, "")
    .replace(/[^A-Za-z0-9_.-]/g, "-")
    .slice(-80);
  for (let i = 0; i < lines.length; i++) {
    const explicit =
      /^#{1,4}\s+([A-Z][A-Z0-9]*-US-\d+|US-\d+)\s*(?:[:—–-]\s*)?(.+)?$/i.exec(
        lines[i],
      );
    const spec = /^#{1,4}\s+User Story\s+(\d+)\s*[-:–—]\s*(.+)/i.exec(lines[i]);
    if (explicit)
      starts.push({
        index: i,
        id: explicit[1],
        title: explicit[2] || explicit[1],
      });
    else if (spec)
      starts.push({ index: i, id: `${prefix}:US-${spec[1]}`, title: spec[2] });
  }
  if (!starts.length) {
    const declared = /^Story ID:\s*(\S+)\s*$/im.exec(content);
    if (declared)
      starts.push({
        index: 0,
        id: declared[1],
        title:
          lines.find((l) => /^#\s/.test(l))?.replace(/^#\s+/, "") ||
          declared[1],
      });
  }
  return starts.map((s, i) => {
    const section = lines
      .slice(s.index, starts[i + 1]?.index || lines.length)
      .join("\n");
    const acceptance =
      /^#{2,6}\s+Acceptance(?: Criteria| Scenarios)?[^\n]*\n([\s\S]*?)(?=^#{1,6}\s|$(?![\s\S]))/im.exec(
        section,
      )?.[1] || "";
    return Story.parse({
      id: s.id,
      title: s.title,
      description: section,
      acceptance: acceptance
        .split("\n")
        .filter((l) => /^\s*(?:[-*]|\d+\.)\s/.test(l))
        .map((l) => l.trim()),
      source: name,
      line: s.index + 1,
      sourceHash: hash(content),
      assignee: "",
      service: "",
    });
  });
}
export function importDocuments(
  state: ProjectState,
  files: { path: string; content: string }[],
) {
  if (!Array.isArray(files) || !files.length || files.length > 200)
    fail("Choose 1–200 documents.");
  const sources = new Map(state.sources.map((s) => [s.path, s]));
  const seen = new Set<string>();
  for (const file of files) {
    if (!file || typeof file !== "object" || Array.isArray(file))
      fail("Each source must include a path and text content.");
    const name = safeSource(file.path);
    if (seen.has(name)) fail("Duplicate source path.");
    seen.add(name);
    if (typeof file.content !== "string" || file.content.length > 100000)
      fail("Source exceeds 100 KB.");
    sources.set(name, {
      path: name,
      content: file.content,
      hash: hash(file.content),
    });
  }
  const stories: StoryRecord[] = [];
  const ids = new Set<string>();
  for (const source of sources.values())
    if (/\.md$/i.test(source.path))
      for (const story of normalizeMarkdown(source.path, source.content)) {
        if (ids.has(story.id)) fail(`Duplicate story ID: ${story.id}`);
        ids.add(story.id);
        const prior = state.stories.find((s) => s.id === story.id);
        stories.push({
          ...story,
          assignee: prior?.assignee || "",
          service: prior?.service || "",
        });
      }
  const protectedIds = new Set([
    ...(state.analysis?.dependencies || []).filter(d => d.review === "CONFIRMED").flatMap(d => [d.provider, d.consumer]),
    ...(state.analysis?.decisions || []).filter(q => q.critical).flatMap(q => q.storyIds),
    ...state.contracts.map(c => c.providerStory),
  ]);
  const removed = [...protectedIds].filter(key => !ids.has(key));
  if (removed.length)
    fail(`Keep the stable story IDs ${removed.join(", ")}. They are referenced by reviewed dependencies, critical decisions, or contracts. Update the existing story text instead; retiring these stories is not supported yet.`);
  return { ...state, sources: [...sources.values()], stories };
}
export function readDocuments(root: string, sourcePath: string) {
  const base = fs.realpathSync(root),
    target = path.resolve(base, sourcePath),
    files: { path: string; content: string }[] = [];
  const inside = (p: string) => p === base || p.startsWith(base + path.sep);
  if (!inside(target)) fail("Source must be inside the selected repository.");
  function walk(file: string) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) fail("Symlink sources are not allowed.");
    if (!inside(fs.realpathSync(file))) fail("Source escapes repository.");
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(file)) {
        if (entry.startsWith(".") || ["node_modules", "dist"].includes(entry))
          continue;
        walk(path.join(file, entry));
      }
    } else if (/\.(md|json|ya?ml)$/i.test(file)) {
      const relative = path.relative(base, file).replaceAll("\\", "/");
      safeSource(relative);
      if (stat.size > 100000) fail("Source exceeds 100 KB.");
      files.push({ path: relative, content: fs.readFileSync(file, "utf8") });
      if (files.length > 200) fail("Too many source files.");
    }
  }
  walk(target);
  return files;
}
