import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SpecMesh,
  manifest,
  impact,
  compareContracts,
  latestApproved,
  applyAnalysis,
} from "../packages/specmesh/src/core.ts";
import {
  Contract,
  sourceHash,
  fail,
} from "../packages/specmesh/src/model.ts";
import { readDocuments } from "../packages/specmesh/src/importer.ts";
import {
  CodexProvider,
  DemoProvider,
  diagnostic,
  bundle,
  readContext,
  validateExchangeState,
} from "../packages/specmesh/src/ai.ts";
import {
  demoFiles,
  demoProposal,
  demoContract,
} from "../packages/specmesh/src/demo.ts";
import { startMock } from "../packages/specmesh/src/mock.ts";

const opts: Record<string, string> = {},
  words: string[] = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith("--")) {
    const name = process.argv[i].slice(2);
    if (["allow-ai", "confirm", "with-mocks"].includes(name)) {
      opts[name] = "true";
      continue;
    }
    if (!process.argv[i + 1] || process.argv[i + 1].startsWith("--"))
      fail(`Missing --${name} value.`);
    opts[name] = process.argv[++i];
  } else words.push(process.argv[i]);
}
const root = path.resolve(opts.root || "."),
  service = new SpecMesh(root),
  actor = opts.reviewer || "local-developer";
const print = (x: unknown) => console.log(JSON.stringify(x, null, 2));
function outputFile(name: string, folder = "reports") {
  return path.resolve(
    opts.output || path.join(service.store.root, folder, name),
  );
}
function checkOutput(name: string, folder = "reports") {
  if (fs.existsSync(outputFile(name, folder)))
    fail("Output already exists. Choose a new --output path; existing exports are never overwritten.");
}
function write(name: string, data: unknown, folder = "reports") {
  const file = outputFile(name, folder);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof data === "string" ? data : JSON.stringify(data, null, 2),
    { flag: "wx" },
  );
  console.log(`Wrote ${file}`);
}
async function main() {
  const [command, sub, arg] = words;
  if (command === "doctor") {
    const provider = new CodexProvider({ model: opts.model });
    print({
      ...(await diagnostic()),
      selectedModel: provider.model || null,
      modelSource: opts.model ? "--model" : process.env.SPECMESH_CODEX_MODEL ? "SPECMESH_CODEX_MODEL" : "CLI built-in default",
      modelNote: "Analysis ignores user config. Pass --model or SPECMESH_CODEX_MODEL when the CLI default is unavailable. Authentication status does not verify model access or CLI compatibility.",
    });
    return;
  }
  if (command === "init") {
    print(service.store.init(opts.name || path.basename(root)));
    return;
  }
  if (command === "demo") {
    service.store.init(
      "CashFlash · synthetic coordination example",
      "",
      "",
      true,
    );
    if (!service.read().sources.length) service.import(demoFiles, actor);
    const s = service.read();
    if (!s.analysis)
      service.analyze(demoProposal(s), "demo", sourceHash(s), actor);
    print({
      root,
      stories: service.read().stories.length,
      message:
        "Synthetic sources analyzed. Review dependencies and decisions, then generate and explicitly approve contracts. No approvals are automatic.",
    });
    return;
  }
  if (command === "registry" && sub === "import") {
    const pack = JSON.parse(fs.readFileSync(path.resolve(arg || ""), "utf8"));
    if (pack.format !== "specmesh-registry" || pack.version !== 1)
      fail("Expected a SpecMesh registry export.");
    const incoming = validateExchangeState(pack.state);
    service.store.init(incoming.project.name);
    const current = service.read();
    if (current.sources.length || current.contracts.length)
      fail(
        "Registry import requires an empty initialized project. Use a new folder.",
      );
    for (const c of incoming.contracts.filter((c) => c.status === "APPROVED"))
      service.store.publish(c);
    service.store.save(
      { ...incoming, revision: current.revision },
      current.revision,
      actor,
      "import-registry",
    );
    print({ imported: true });
    return;
  }
  if (command === "import") {
    print(service.import(readDocuments(root, sub || "specs"), actor));
    return;
  }
  if (command === "context") {
    write("context.json", bundle(service.read()));
    return;
  }
  if (command === "analyze") {
    if (!["demo", "codex"].includes(opts.provider))
      fail("Choose --provider demo or --provider codex.");
    if (opts.provider === "codex" && opts["allow-ai"] !== "true")
      fail(
        "Review the source bundle, then add --allow-ai to send that context to your authenticated Codex session.",
      );
    checkOutput("proposal.json");
    const ensureEmpty = () => {
      if (!fs.existsSync(service.store.file())) return;
      const current = service.read();
      if (current.sources.length || current.contracts.length || current.analysis)
        fail("Use an empty local project for an exported context.");
    };
    if (opts.context) ensureEmpty();
    const s = opts.context
        ? readContext(JSON.parse(fs.readFileSync(path.resolve(opts.context), "utf8")))
        : service.read(),
      provider =
        opts.provider === "demo" ? new DemoProvider() : new CodexProvider({ model: opts.model });
    const proposal = await provider.analyzeStories(s);
    const analyzed = applyAnalysis(
      s,
      proposal,
      opts.provider as "demo" | "codex",
    );
    if (opts.context) {
      // A rejected/failed AI result leaves the target empty and safe to retry.
      ensureEmpty();
      const current = service.store.init(s.project.name, "", "", s.project.demo);
      for (const contract of analyzed.contracts) service.store.publish(contract);
      service.store.save(
        { ...analyzed, project: { ...current.project, demo: s.project.demo }, revision: current.revision, audit: current.audit },
        current.revision,
        actor,
        "analyze-context",
      );
    } else {
      service.store.save(analyzed, s.revision, actor, "analyze", opts.provider);
    }
    write("proposal.json", {
      sourceHash: sourceHash(s),
      provider: opts.provider,
      proposal,
    });
    return;
  }
  if (command === "graph") {
    const s = service.read();
    print(s.analysis);
    return;
  }
  if (command === "dependency" && sub === "review") {
    if (opts.confirm !== "true")
      fail("Use --confirm after reviewing the evidence.");
    print(service.reviewDependency(arg, true, actor));
    return;
  }
  if (command === "decision" && sub === "resolve") {
    print(service.decide(arg, "RESOLVED", opts.reason || "", actor));
    return;
  }
  if (command === "contracts" && sub === "generate") {
    const s = service.read(),
      key = opts.interface;
    if (!key) fail("Choose --interface.");
    if (opts.provider === "demo") {
      demoProposal(s);
      const providers: Record<string, string> = {
        IdentityAPI: "US-1",
        BankAccountAPI: "US-2",
        TransferAPI: "US-3",
      };
      print(
        await service.draft(
          {
            id: key,
            version: opts.version || "1.0.0",
            providerStory: providers[key],
            document: demoContract(key, opts.version || "1.0.0"),
            origin: "demo",
          },
          actor,
        ),
      );
      return;
    }
    if (opts.provider !== "codex" || opts["allow-ai"] !== "true")
      fail("Use --provider codex --allow-ai only after reviewing context.");
    Contract.pick({ id: true, version: true, providerStory: true }).parse({
      id: key,
      version: opts.version || "1.0.0",
      providerStory: opts.story,
    });
    if (!s.stories.some((story) => story.id === opts.story))
      fail("Choose a known provider story with --story before requesting AI.");
    if (s.contracts.some((contract) => contract.id === key && contract.version === (opts.version || "1.0.0")))
      fail("This version already exists. Choose a new --version before requesting AI.");
    if (s.contracts.some((contract) => contract.id === key && contract.providerStory !== opts.story)
      || s.analysis?.dependencies.some((dependency) => dependency.interfaceId === key && dependency.review !== "REJECTED" && dependency.provider !== opts.story))
      fail("The selected provider conflicts with this interface's recorded owner.");
    const result = await new CodexProvider({ model: opts.model }).proposeContracts(s, key, {
      version: opts.version || "1.0.0", providerStory: opts.story,
    });
    print(
      await service.draft(
        {
          id: key,
          version: opts.version || "1.0.0",
          providerStory: opts.story,
          document: result.document,
          origin: "codex",
        },
        actor,
      ),
    );
    return;
  }
  if (command === "contracts" && sub === "import") {
    const document = fs.readFileSync(path.resolve(arg), "utf8");
    print(
      await service.draft(
        {
          id: opts.interface,
          version: opts.version,
          providerStory: opts.story,
          document,
        },
        actor,
      ),
    );
    return;
  }
  if (command === "contracts" && sub === "approve") {
    if (!opts.reviewer || opts.confirm !== "true")
      fail(
        "Supply --reviewer, --reason and --confirm after inspecting the contract. Local reviewer identity is self-declared.",
      );
    const c = service
      .read()
      .contracts.find((c) => c.id === arg && c.version === opts.version);
    if (!c) fail("Contract not found.");
    print(
      await service.approve(c.id, c.version, c.hash, opts.reason || "", actor),
    );
    return;
  }
  if (command === "contracts" && sub === "validate") {
    const { validateDocument } = await import(
      "../packages/specmesh/src/contracts.ts"
    );
    const checks = await Promise.all(
      service.read().contracts.map(async (c) => ({
        id: c.id,
        version: c.version,
        ...(await validateDocument(c.document)),
      })),
    );
    print(checks);
    if (checks.some((c) => c.errors.length)) process.exitCode = 1;
    return;
  }
  if (command === "contracts" && sub === "diff") {
    const s = service.read(),
      next = s.contracts.find(
        (c) => c.id === arg && c.version === opts.version,
      ),
      before = latestApproved(s, arg);
    if (!next || !before)
      fail("Select a proposed version and an existing approved baseline.");
    print({
      comparison: compareContracts(before.document, next.document),
      impact: impact(s, arg),
    });
    return;
  }
  if (command === "workspace") {
    if (!sub) fail("Choose a story ID: workspace <story>.");
    checkOutput(sub.replaceAll(":", "-") + ".manifest.json", "manifests");
    const s = service.read();
    const mocks: Awaited<ReturnType<typeof startMock>>[] = [];
    if (opts["with-mocks"] === "true") {
      const initial = manifest(s, sub);
      if (!initial.contractReady)
        fail("Resolve contract readiness before starting workspace mocks.");
      try {
        for (const key of initial.consumed) {
          const c = latestApproved(s, key)!;
          if (!service.store.verifySnapshot(c))
            fail("Published snapshot failed verification.");
          mocks.push(await startMock(c));
        }
      } catch (e) {
        await Promise.all(mocks.map((m) => m.close()));
        throw e;
      }
    }
    const m = manifest(
      s,
      sub,
      mocks.map((m) => `${m.contractId}@${m.version}`),
    );
    for (const pinned of m.contracts) {
      const c = s.contracts.find(
        (c) => c.id === pinned.id && c.version === pinned.version,
      )!;
      if (!service.store.verifySnapshot(c))
        m.blockers.push(`Missing or modified snapshot: ${c.id}@${c.version}`);
    }
    if (m.blockers.length) {
      m.contractReady = false;
      m.developmentReady = false;
    }
    try {
      write(sub.replaceAll(":", "-") + ".manifest.json", {
        ...m,
        mocks: mocks.map(({ close, ...mock }) => mock),
      }, "manifests");
    } catch (e) {
      await Promise.all(mocks.map((m) => m.close()));
      throw e;
    }
    if (mocks.length) {
      print({
        mocks: mocks.map(({ close, ...mock }) => mock),
        developmentReady: m.developmentReady,
        integrationReady: false,
      });
      for (const signal of ["SIGINT", "SIGTERM"])
        process.on(signal, () => {
          void Promise.all(mocks.map((m) => m.close())).then(() =>
            process.exit(),
          );
        });
    }
    return;
  }
  if (command === "impact") {
    print(impact(service.read(), sub));
    return;
  }
  if (command === "verify") {
    const result = await service.verify();
    print(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === "mock" && sub === "start") {
    const s = service.read(),
      c = opts.version
        ? s.contracts.find((c) => c.id === arg && c.version === opts.version)
        : latestApproved(s, arg);
    if (!c || !service.store.verifySnapshot(c))
      fail("An intact approved snapshot is required.");
    const mock = await startMock(c, Number(opts.port || 4010));
    print({
      ...mock,
      close: undefined,
      note: "Simulated behavior only. Send x-specmesh-status to choose a documented response.",
    });
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, () => {
        void mock.close().then(() => process.exit());
      });
    return;
  }
  if (command === "registry" && sub === "export") {
    write("registry.json", {
      format: "specmesh-registry",
      version: 1,
      state: service.read(),
    });
    return;
  }
  if (command === "dashboard") {
    const entry = fileURLToPath(new URL("../server/index.js", import.meta.url));
    const port = Number(opts.port || 4319);
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      fail("Choose a port from 1024 to 65535.");
    console.log(`Starting Companion: http://127.0.0.1:${port}/?page=specmesh`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [entry], {
        cwd: path.dirname(path.dirname(entry)),
        env: { ...process.env, TOKEN_MONITOR_PORT: String(port) },
        stdio: "inherit",
        windowsHide: true,
        shell: false,
      });
      child.on("error", reject);
      child.on("close", (code) => {
        process.exitCode = code || 0;
        resolve();
      });
    });
    return;
  }
  fail(
    "Commands: init, import <path>, context, analyze --provider demo|codex, doctor, graph, dependency review, decision resolve, contracts generate|import|validate|approve|diff, workspace <story>, mock start <interface>, impact <interface>, verify, registry import|export, demo. Use --root <repository>.",
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
