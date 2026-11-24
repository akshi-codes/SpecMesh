# SpecMesh in Codex Companion

SpecMesh coordinates requirements and shared interfaces inside the existing team app. It does not replace your delivery methodology or implement user stories. Teams and sign-in remain in Companion; the new TypeScript core is shared by the dashboard API and a local CLI.

## Start

Use Node.js 24 or later (Node 24 LTS is the baseline).

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run dev
```

Open `http://127.0.0.1:4319/?page=specmesh`. Create a private project or select a team that you lead. Team members can read/export that team's project; owners and team leads import sources and proposals, review dependencies, resolve decisions, assign stories, and approve contracts. Reviewer identities in the dashboard come from the authenticated local account. They are not enterprise-verified identities.

Choose **New project → synthetic demo** for a five-story example. The demo uses the same persistence, validation, review, comparison, graph and readiness code as real projects. It never automatically approves anything. The isolated CLI equivalent is `npm.cmd run demo` (under `data/specmesh-demo`); CLI projects and dashboard projects have separate registry locations.

## Import and coordinate real stories

1. Import selected Markdown specifications, architecture notes, and bundled JSON/YAML contracts through **Stories**. Imported existing contracts are analysis context; add them as contract drafts explicitly when you want to publish them.
2. Markdown supports `# US-1 — Title`, `# IA-US-01 — Title`, a `Story ID:` field, and Spec Kit `### User Story 1 - Title` sections. Spec Kit section IDs are qualified by source path, for example `feature-a-spec:US-1`; these are local source identifiers, not newly allocated company feature IDs. Acceptance-criteria bullets are preserved when identified. Unrecognized Markdown remains context and does not silently become a story.
3. Download a source bundle from **Exchange**. Inspect it before invoking Codex locally. All selected sources are analyzed together, including architecture documents and existing approved definitions.
4. Upload the resulting proposal and explicitly confirm the preview. The source fingerprint must still match. References and exact evidence quotes are validated. Uploaded approvals and decision resolutions are reset to review-required/open.
5. Review dependencies and resolve or waive critical questions with a rationale. API, data, event, business and implementation dependencies remain distinct.
6. Propose a canonical OpenAPI 3.1 contract with its provider and semantic version. Review validation errors, source evidence, consumers, decisions and changes. Approval requires the exact draft hash, current sources, reviewed dependencies, and resolution of critical questions.
7. Export the registry to each developer. Generate story manifests and local mocks. Commit the registry and approved snapshots through your existing Git review workflow.
8. Propose later contract versions to see structural compatibility findings and direct/transitive impact, including recorded developer assignments. `verify` also detects pending changes and modified approved snapshots.

The graph uses live project records, supports pan/zoom, dependency-type filters, node inspection, upstream/downstream highlighting for story selections, and cycle detection. It does not infer a service topology from story titles. Related services are explicit story metadata.

## Local AI execution

No Platform API key is required by SpecMesh. Each developer uses their own supported Codex CLI authentication, subject to company permissions. SpecMesh never reads or copies authentication files. The shared web API has no live-AI execution endpoint.

```powershell
npm.cmd run specmesh -- doctor
# If needed, sign in yourself with the supported Codex login flow:
codex login

# Download this bundle from Exchange and inspect its contents first.
npm.cmd run specmesh -- analyze --root ./analysis --context ./specmesh-context.json --provider codex --allow-ai --output proposal.json
```

Use a new empty analysis folder for each exported context. Set `SPECMESH_CODEX_PATH` to the actual Codex executable if it is not on PATH. The diagnostic uses `codex login status` and reports availability without printing authentication material. A successful diagnostic does not prove model access or a successful analysis call.

The installed CLI was inspected for `--ignore-user-config`, `--ephemeral`, `--sandbox read-only`, and structured-output support. The official CLI fallback is intentional: the inspected TypeScript SDK did not expose the `--ignore-user-config` isolation switch. Analysis excludes user-configured integrations, disables shell/multi-agent/web tools, runs in a temporary working directory, passes an allowlisted environment without API keys, caps input at 1 MB and output at 2 MB, and times out after three minutes. Enterprise-managed restrictions remain effective. Unsupported CLI versions fail explicitly. Live AI was not invoked during implementation or tests.

AI output is treated as a proposal, not authority. Selected source text is untrusted input, not application instructions. Failed or malformed analysis never falls back silently to demo output. The demo provider only accepts the unchanged five bundled fixture sources.

Official references: [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), [non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode), [authentication](https://learn.chatgpt.com/docs/auth).

## CLI reference

All commands run from the Companion checkout and accept `--root <target-repository>`; there is no global install requirement. Writes to user-selected exports refuse to overwrite existing files.

```powershell
npm.cmd run specmesh -- init --root C:/Projects/MyApp --name MyApp
npm.cmd run specmesh -- import specs --root C:/Projects/MyApp
npm.cmd run specmesh -- context --root C:/Projects/MyApp --output context.json
npm.cmd run specmesh -- analyze --root C:/Projects/MyApp --provider codex --allow-ai --output proposal.json
npm.cmd run specmesh -- graph --root C:/Projects/MyApp
npm.cmd run specmesh -- dependency review DEP-1 --root C:/Projects/MyApp --reviewer "Developer A" --confirm
npm.cmd run specmesh -- decision resolve DEC-1 --root C:/Projects/MyApp --reviewer "Developer A" --reason "Recorded architectural decision and evidence"
npm.cmd run specmesh -- contracts import ./api.yaml --root C:/Projects/MyApp --interface AccountsAPI --story US-2 --version 1.0.0
npm.cmd run specmesh -- contracts validate --root C:/Projects/MyApp
npm.cmd run specmesh -- contracts approve AccountsAPI --root C:/Projects/MyApp --version 1.0.0 --reviewer "Developer A" --reason "Reviewed provider and consumer requirements" --confirm
npm.cmd run specmesh -- workspace US-3 --root C:/Projects/MyApp
npm.cmd run specmesh -- workspace US-3 --root C:/Projects/MyApp --with-mocks --output us3-live-manifest.json
npm.cmd run specmesh -- mock start AccountsAPI --root C:/Projects/MyApp --port 4010
npm.cmd run specmesh -- contracts diff AccountsAPI --root C:/Projects/MyApp --version 2.0.0
npm.cmd run specmesh -- impact AccountsAPI --root C:/Projects/MyApp
npm.cmd run specmesh -- verify --root C:/Projects/MyApp
```

`contracts generate --interface <id> --story <id> --version <semver> --provider codex --allow-ai` invokes local Codex and validates/stores its draft. Add a draft to the dashboard by copying its OpenAPI document into **Propose contract**. This does not transfer approval. In demo projects, `--provider demo` uses the named fixture APIs without an AI call.

Use `--model <available-model>` on `analyze`, `contracts generate`, or `doctor`, or set `SPECMESH_CODEX_MODEL`. Choose a model available to your account in Codex. Isolated runs intentionally do not inherit your usual user-config model setting. If that model requires a newer CLI, update Codex or set `SPECMESH_CODEX_PATH` to a compatible already-installed executable. `doctor` reports authentication and selection; it cannot establish that inference will succeed.

`registry export --output registry.json` exports state. `registry import registry.json --root ./new-project` hydrates an empty local registry and its approved snapshots, checking content hashes. Do not use registry imports from untrusted sources; local approval metadata is self-declared, not signed enterprise identity. `dashboard --port 4319` starts the Companion server using the checkout's production build.

## Readiness and mocks

Contract-ready means the current relevant HTTP contracts and dependency reviews meet the recorded gates. `workspace --with-mocks` starts the required approved providers on free loopback ports, records their URLs and pinned hashes, and computes development readiness using those actual running instances. Keep that process running; use Ctrl+C to stop its mocks. A saved manifest is a point-in-time record, not a health monitor.

The engine validates OpenAPI 3.1 with Swagger Parser and examples/requests with Ajv 2020. Its deliberately bounded subset supports JSON bodies/responses, primitive path/query/header parameters, bearer-header presence simulation, and explicit success/error examples. Document 401 for authentication and 422 for validation failures. Use `x-specmesh-status: 404` to select a documented response. Responses carry `x-specmesh-mock: simulated`.

External `$ref` files/URLs, YAML aliases, unsupported media/authentication and responses without examples are rejected. Bundle references locally first. Mocks do not validate real credentials, implement business transactions, emit events, or prove the real service works. Non-HTTP incoming dependencies remain separate development inputs; their automated readiness/AsyncAPI mocking is deferred. **Implementation verified and integration ready remain false** until a real verification-evidence workflow is added.

Compatibility checks deterministically identify removed endpoints/definitions, type/format changes and incompatible required-field guarantees. Other structural changes are manual-review findings. Schema composition, constraints, business semantics and auth behavior are not declared compatible automatically. Breaking changes require a major version increase plus human review.

## Persistence, Git and recovery

Each CLI project owns `.specmesh/state/project.json`, configuration/policy metadata, immutable `.specmesh/contracts/approved/<interface>/<version>.json`, manifests and reports. Writes use a revision check, exclusive lock and atomic replacement with bounded retries for transient Windows locks. Initialization does not overwrite existing state, config, or project-level agent instructions. Policies are enforced in the service; editing the descriptive policy YAML does not bypass them.

Keep story IDs stable when editing imported documents. Imports reject removal or renaming of stories referenced by confirmed dependencies, critical decisions, or contracts; retiring reviewed stories is not supported yet. Expanded decision scope requires another review. Failed concurrent approvals do not leave newly published snapshots.

Dashboard projects live in `specmesh-projects/<project-key>/.specmesh` beside the configured Companion SQLite database. They are separate from the usage database and the existing v3 usage backup. **Back up this project directory too**, or export each registry through Exchange. Stop the server before copying/restoring its project directories. Restoring only a usage/account backup can leave project ownership referring to older account IDs; keep account and project recovery copies aligned.

Use ordinary Git commits/MRs for canonical published snapshots and registry state. `verify` checks their integrity and reports blocking findings as JSON with a nonzero exit status. It does not commit, merge, synchronize branches, or establish trust in a modified Git repository. Configuration is intentionally local; no database migration or hosted deployment is required for this module.

In CI, after `npm ci`, run `npm run typecheck`, `npm test`, and `npm run specmesh -- verify --root <checked-out-project>`. No Codex session is needed for these checks. Do not run `--allow-ai` in an untrusted pipeline.

## Workflow compatibility

Spec Kit integration is document-based: import its story sections and give its planning/implementation stage the pinned manifest and approved definitions. No undocumented extension hooks are installed. See the [official Spec Kit repository](https://github.com/github/spec-kit).

Davaflow integration is also document-based for now. Import the requirements/contracts it exports and feed reviewed artifacts back into your existing process. This makes no claim about proprietary Davaflow APIs or what capabilities it already provides. Formal extension packaging and connected issue-tracker synchronization remain future work.

## Verification and limits

- Core/API tests cover source references and duplicate IDs, proposal evidence validation, canonical ownership, invalid contracts, approval gates, immutable snapshots, staleness, actual mock HTTP calls, breaking changes, transitive impact, concurrent-write rejection, project/team isolation and the five-story rehearsal.
- CLI tests cover repeatable demo initialization, blocked verification, registry transfer, manifests and refusal to invoke AI without `--allow-ai`.
- Browser checks cover the real dependency map, review persistence, sample draft creation and inspection; the existing application regression suite remains part of `npm test`.
- The sanity review also covers project creation/switching, assignments, blocked approval feedback inside panels, and shared-project refresh. Open dashboards refresh server state every 15 seconds while visible; Refresh fetches it immediately. Local repository import and registry exchange remain explicit actions.
- Regression suites include review-pack duplicate prevention and stable timestamps, recoverable backup ownership, approval publication rollback, altered contract hashes, malformed imports, schema fields named like OpenAPI annotations, and copied-context workflows with approved contracts.
- Live Codex analysis passed using only the five synthetic demo stories with the installed desktop CLI `0.164.0-alpha.11.1` and an explicitly selected account-supported model. It returned eight dependencies and eight open critical decisions; exact source-evidence validation passed, and no approval was granted automatically. The older standalone CLI `0.142.0` failed model compatibility before producing a proposal. Real project analysis, live contract generation, and real service integration remain unverified; authentication availability alone is not inference acceptance.
- Source updates are detected on import; draft changes on proposal; registry checks on `verify`. Background repository watching and automatic cross-computer synchronization are not implemented.
- This is a working first coordination release, not the entire proposed platform. Advanced semantic comparison, real provider/consumer conformance tests, event mocking, signed organizational approval, enterprise SSO, automatic repository synchronization, and packaged Davaflow/Spec Kit integrations remain open.
- The existing application dependency tree still has npm audit findings, including development tooling. This work does not claim production security certification or resolve unrelated major-version migrations.
