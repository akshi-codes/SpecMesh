import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { State, hash, fail } from "./model.ts";
import type { ProjectState, ContractRecord } from "./model.ts";

export class FileStore {
  root: string;
  constructor(root: string) {
    this.root = path.resolve(root, ".specmesh");
    for (const relative of [
      "",
      "state",
      "state/project.json",
      "contracts",
      "contracts/approved",
    ]) {
      const candidate = path.join(this.root, relative);
      if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink())
        fail("Symlinks are not allowed inside the SpecMesh registry.");
    }
  }
  file() {
    return path.join(this.root, "state", "project.json");
  }
  init(name: string, ownerId = "", teamId = "", demo = false): ProjectState {
    if (fs.existsSync(this.file())) return this.read();
    fs.mkdirSync(path.dirname(this.file()), { recursive: true });
    const state = State.parse({
      schemaVersion: 1,
      revision: 0,
      project: {
        id: randomUUID(),
        name,
        ownerId,
        teamId,
        demo,
        createdAt: new Date().toISOString(),
      },
      sources: [],
      stories: [],
      analysis: null,
      contracts: [],
      audit: [],
    });
    fs.writeFileSync(this.file(), JSON.stringify(state, null, 2), {
      flag: "wx",
    });
    for (const folder of [
      "contracts/drafts",
      "contracts/approved",
      "decisions",
      "manifests",
      "reports",
    ])
      fs.mkdirSync(path.join(this.root, folder), { recursive: true });
    const config = path.join(this.root, "config.yaml");
    if (!fs.existsSync(config))
      fs.writeFileSync(
        config,
        `schemaVersion: 1\nproject:\n  name: ${JSON.stringify(name)}\nstories:\n  paths: [specs]\nai:\n  provider: codex\n  execution: local-explicit\ncontracts:\n  format: openapi-3.1\n  approval_required: true\n`,
        { flag: "wx" },
      );
    const policy = path.join(this.root, "policies.yaml");
    if (!fs.existsSync(policy))
      fs.writeFileSync(
        policy,
        "# Enforced MVP policies; changing this file does not bypass review gates.\napproval_required: true\ncritical_decisions_block_approval: true\napproved_versions_immutable: true\n",
        { flag: "wx" },
      );
    return state;
  }
  read(): ProjectState {
    if (!fs.existsSync(this.file()))
      fail("Initialize this project first.", 404);
    return State.parse(JSON.parse(fs.readFileSync(this.file(), "utf8")));
  }
  save(
    value: ProjectState,
    expected: number,
    actor: string,
    action: string,
    target = "",
    publication?: ContractRecord,
  ): ProjectState {
    const lock = path.join(this.root, "state", "write.lock");
    let fd: number;
    try {
      fd = fs.openSync(lock, "wx");
    } catch {
      fail(
        "Another write is in progress. Retry. If a process crashed, remove .specmesh/state/write.lock after confirming it stopped.",
        409,
      );
    }
    const temp = this.file() + "." + randomUUID() + ".tmp";
    let publishedFile: string | undefined;
    let committed = false;
    try {
      if (this.read().revision !== expected)
        fail("Project changed. Reload before applying this operation.", 409);
      const state = State.parse({
        ...value,
        revision: expected + 1,
        audit: [
          ...value.audit,
          { at: new Date().toISOString(), actor, action, target },
        ],
      });
      fs.writeFileSync(temp, JSON.stringify(state, null, 2));
      if (publication) publishedFile = this.publish(publication);
      for (let attempt = 0; ; attempt++) {
        try {
          fs.renameSync(temp, this.file());
          break;
        } catch (error: any) {
          if (
            !["EPERM", "EACCES", "EBUSY"].includes(error.code) ||
            attempt >= 6
          )
            throw error;
          // Windows scanners can briefly hold the destination; never truncate it.
          Atomics.wait(
            new Int32Array(new SharedArrayBuffer(4)),
            0,
            0,
            15 * (attempt + 1),
          );
        }
      }
      committed = true;
      return state;
    } finally {
      try {
        if (!committed && publishedFile && fs.existsSync(publishedFile))
          fs.unlinkSync(publishedFile);
      } finally {
        fs.closeSync(fd);
        fs.unlinkSync(lock);
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
      }
    }
  }
  publish(contract: {
    id: string;
    version: string;
    document: unknown;
    hash: string;
  }) {
    if (hash(contract.document) !== contract.hash)
      fail("Contract content does not match its approved hash.", 409);
    const folder = path.join(this.root, "contracts", "approved", contract.id);
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, contract.version + ".json");
    if (fs.existsSync(file)) {
      if (hash(JSON.parse(fs.readFileSync(file, "utf8"))) !== contract.hash)
        fail(
          "An immutable version already exists with different content.",
          409,
        );
      return;
    }
    fs.writeFileSync(file, JSON.stringify(contract.document, null, 2), {
      flag: "wx",
    });
    return file;
  }
  verifySnapshot(contract: {
    id: string;
    version: string;
    hash: string;
    document?: unknown;
  }): boolean {
    try {
      if (contract.document !== undefined && hash(contract.document) !== contract.hash)
        return false;
      return (
        hash(
          JSON.parse(
            fs.readFileSync(
              path.join(
                this.root,
                "contracts",
                "approved",
                contract.id,
                contract.version + ".json",
              ),
              "utf8",
            ),
          ),
        ) === contract.hash
      );
    } catch {
      return false;
    }
  }
}
