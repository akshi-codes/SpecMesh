# SpecMesh

SpecMesh is a local-first workspace for coordinating software requirements and shared API contracts. The Codex Companion dashboard also includes team tasks, playbooks, weekly reviews, and local usage reporting.

## Quick start

Install Node.js 24 or later and npm. From the repository root, run:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run dev
```

Use `npm` in place of `npm.cmd` on macOS or Linux. Open [SpecMesh locally](http://127.0.0.1:4319/?page=specmesh) and create the installation-owner account on first launch. A first-run owner does not need an invitation code.

## Try SpecMesh

1. Select **SpecMesh → New project**. For a ready-made walkthrough, select the synthetic demo option.
2. To try a Markdown import, create a regular project and use **Stories → Import documents** with the [Equipment Lending sample](examples/specmesh-equipment-lending.md).
3. For dependency analysis of imported stories, download the source bundle from **Exchange**, run the optional Codex CLI workflow locally, and import the resulting proposal for review. The built-in demo supplies a deterministic proposal.
4. Review dependencies and decisions, validate and approve versioned OpenAPI contracts, and export the registry for local development.

Use `npm run demo` for the CLI walkthrough. See the [SpecMesh workflow and CLI guide](docs/specmesh.md) for contract review, compatibility checks, local mocks, and recovery.

## Shared workspace

- Create teams and single-use invitations (valid for seven days); manage member/lead roles.
- Keep tasks private or share them with a team. Leads can update shared outcomes and blockers; private tasks remain private.
- Link local Codex threads to tasks, record outcomes, rework, lessons and issue/PR references. A thread can belong to one task.
- Compare tasks side by side; save reusable playbooks with evidence; record weekly review notes.
- Preview selected review packs before downloading or importing. Reimporting the same contributor/source/task updates its snapshot. No employee productivity score is calculated.

### First run and team access

Open the app on the server machine and create the installation-owner account before enabling remote access. Usernames are unique and passwords require at least 12 characters. Additional accounts require a team invitation; existing users can join another team using a code. Share the code yourself. Sessions expire after seven days.

The server defaults to loopback. To allow access on your internal network, set `TOKEN_MONITOR_HOST=0.0.0.0` and `TOKEN_MONITOR_PUBLIC_ORIGIN` to the exact browser origin (scheme, host, port), then start the server. All members use that same app and database. For authenticated access across a network, terminate HTTPS at your company proxy and set `TOKEN_MONITOR_SECURE_COOKIE=true`. No deployment or firewall changes are performed by this repository. Password recovery, SSO and account removal are not implemented yet.

Only the installation owner can access local ingestion, raw usage reports and data settings. The shared server cannot read other developers’ laptop sessions. Teammates can create tasks directly and contribute selected aggregate evidence using review packs. Team totals include only shared tasks and supplied evidence, not complete company usage.

### Collecting a review pack on another laptop

Run this checkout locally on that laptop, then:

```powershell
node scripts/export-review-pack.js --title "Add retry handling" --from 2026-11-01 --to 2026-11-01 --id retry-handling --output retry.review-pack.json
```

Optional `--threads id1,id2` restricts sessions; `--timezone Asia/Calcutta` defines calendar dates. Inspect the JSON, then upload through **Review packs**, choose sharing visibility, review its contents and confirm. The helper writes a file; it never uploads automatically. Keep the same `--id` when updating a contribution. Packs contain aggregate metrics and explicitly selected notes, not raw session text, local paths or credentials. Notes are user-entered and should be reviewed before sharing.

Usage evidence is marked partial or unavailable. Tool-event coverage depends on the source; outcomes and rework are developer-recorded. Imported snapshots cover the selected period at export time. Weekly review uses task update time, not a fabricated activity timeline.

Full v3 backups include accounts and password hashes, memberships, tasks, playbooks and usage; keep them private. They are recovery files, not team-sharing packs. Restoring a v3 backup signs everyone out. Legacy v2 restoration is rejected while task records exist.

## Usage features

- Thread explorer with a metrics timeline, token breakdowns, model changes, and observed tool failures.
- Today, yesterday, week, and custom date reports with timezone-aware comparisons and matching CSV exports.
- Evidence-linked insights, project/model contributions, and chart-to-detail navigation.
- Opt-in Live mode with debounced file watching, periodic reconciliation, and visible sync freshness.
- Project aliases and reversible groups; thread labels, tags, and bookmarks with complete-history search.
- Persistent budget alerts with configurable thresholds, dismissal, snooze, and rolling-window pacing.
- Folder diagnostics, metrics backup/restore, retention controls, and optional dated API-equivalent cost estimates.
- Responsive light/dark dashboard with animated navigation, dropdowns, detail panels, and notifications; reduced-motion support.
- Incremental ingestion that skips unchanged session files, batches database writes, and runs automatically every 24 hours.
- Import-health reporting for scanned, skipped, failed, protected, duplicate, and invalid records.
- Deterministic efficiency metrics for cache use, tokens per turn, tool errors, and longest threads.
- Durable rolling 7-day and 30-day token budgets globally and per project.
- Project and thread tables with search, filters, sorting, pagination, and project-level exports.
- Filtered detail and daily-summary CSV exports for the selected date range.
- Light and dark themes with persisted preference.
- Dedicated workspace navigation with a compact mobile menu.
- Durable local SQLite persistence.

## Privacy Model

The importer stores metrics only:

- Thread IDs
- Timestamps
- Project paths and names
- Model names
- Status values
- Token counts
- Tool and event counts
- Duration and source metadata when available

The app does not persist prompt text, assistant text, or transcript content.

Denied files include secret and credential-like files such as `auth.json`, `cap_sid`, token caches, browser session stores, and similar credential sources.

## Import Usage Data

The app runs an incremental scan at startup and every 24 hours. Use **Sync now** for an immediate scan, or rebuild metrics in Settings to reprocess session files while preserving budgets and organization. Enable **Live updates** for file watching and reconciliation at the cadence selected in Settings. The dashboard refreshes every five seconds while Live is enabled.

The default Codex home is `%USERPROFILE%\.codex`.

The importer scans safe session metadata and JSONL session files, extracts usage metrics, and discards message content while parsing. After the first scan, unchanged files are skipped.

Set `TOKEN_MONITOR_AUTO_INGEST=false` to disable scheduled scans or `TOKEN_MONITOR_INGEST_INTERVAL_MS` to change the interval.

Live mode is a separate explicit opt-in and still runs when scheduled ingestion is disabled. Notifications require this local app to be running.

## Local data and recovery

On Windows the database defaults to `%LOCALAPPDATA%\codex-token-monitor\token-monitor.sqlite`. An existing legacy temporary database is copied to this location on first launch when the durable database is absent. `TOKEN_MONITOR_DB` overrides the location. Settings can validate an alternative Codex folder before saving it.

SpecMesh project files live in `specmesh-projects/` beside the database and have a separate recovery path. Store generated exports and local runtime files under `data/` when working in the repository. Keep databases, review packs, and private project exports outside version control.

Download a JSON backup before applying retention or rebuilding historical metrics. Restore previews the backup and requires explicit confirmation; it replaces local metrics and preferences atomically. Backups include project paths and user-entered labels, but no session prompts or replies. Restore accepts backups up to 100 MB. Retention defaults to keeping all history; a positive day count removes older usage events and applies to future imports.

## Reading the numbers

Input tokens include cached input; output tokens include reasoning output. The total is input plus output, without counting either subset twice. Cumulative session snapshots become usage deltas. A usage event is not necessarily a user turn. Reimported snapshots and supported telemetry retries are deduplicated; local session metrics take precedence when both sources describe the same thread.

Comparisons use an equal-duration preceding period and the selected reporting timezone. Budget windows remain rolling elapsed 7/30-day windows across all selected budget scopes. Budget projections account for usage aging out and assume the recent average continues. Observed tool counts are limited to explicit records present in the source; they are not complete outcome or productivity measurements.

Optional costs use the model rates and effective dates you enter in Settings. They are API-equivalent estimates, not subscription bills or remaining allowance. Unknown rates remain uncovered. Growing session files are reparsed when changed; unchanged files are skipped.

## Build And Test

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

For an isolated ingestion/report benchmark with 7,500 synthetic events, run
`node scripts/performance-check.js`. It uses a temporary database and never
modifies your imported history. It verifies totals after an initial import,
an unchanged scan, and a forced rebuild, then reports elapsed milliseconds.

## API

Core endpoints include:

- `GET /api/overview?range=`
- `GET /api/usage-summary?range=`
- `GET /api/projects`
- `GET /api/projects/:id/usage`
- `GET /api/threads?projectId=&range=`
- `GET /api/threads/:id`
- `GET /api/budgets`
- `PUT /api/budgets`
- `POST /api/ingest/run`
- `GET /api/ingest/status`
- `GET /api/export.csv?range=&projectId=&format=daily`
- `GET /api/settings`

## Hosted Migration Notes

The frontend talks only to the API and never reads local files directly. The shared workspace uses SQLite and cookie-based authentication. Remote session collection is an explicit review-pack workflow; this version does not install background collectors on teammates’ machines.
