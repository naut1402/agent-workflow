# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`dev-team-dashboard` — a Vue 3 + Vite SPA that visualizes the runtime state of the **dev-agent-teams orchestrator** (a Claude Code plugin pipeline that drives a dev task through investigate → design → implement → review → PR). The dashboard is read-only for task state, but read/write for *configuration* (pipelines, custom agents, templates, knowledge).

Crucially, **this repo does not run the orchestrator** — it observes one. The orchestrator writes filesystem state into a `.dev-team-agent/` workspace folder, and this dashboard reads it back. UI strings are in Vietnamese.

## Commands

```bash
bun install               # bun is the package manager (bun.lock present)
bun run dev               # Vite dev server on :5174, opens browser (single-project mode)
bun run build             # vue-tsc check + build SPA to dist/
bun run serve             # standalone server (server/standalone.ts) on 127.0.0.1:5174 — needs dist/
bun run start             # build + serve
bun run mcp               # run the MCP stdio server (mcp/server.mjs)

bun run typecheck         # vue-tsc --noEmit (type-gate)
bun run test              # backend unit/integration: bun test (tests/server + tests/mcp)
bun run test:fe           # frontend unit: vitest run --coverage (tests/src + tests/shared)
bun run test:e2e          # e2e: @playwright/test (test-e2e/) — boots app + fixture, screenshots
bun run test:all          # typecheck → bun test → vitest → playwright
```

**Testing** (post-TS migration): unit tests live under `tests/` mirroring the source tree — `tests/server` + `tests/mcp` on **bun test**, `tests/src` + `tests/shared` on **vitest** (jsdom). E2E specs are `test-e2e/*.spec.ts` (**@playwright/test**); `playwright.config.ts` boots the standalone server against the `test-e2e/fixtures/.dev-team-agent/` fixture and each spec **attaches** its screenshot to the playwright report (`testInfo.attach`, via `test-e2e/_capture.ts`) — evidence is **not committed to `docs/`**; it ships in the CI `test-evidence` artifact and is attached to the PR result comment. CI (`.github/workflows/ci.yml`) runs the full chain on every push/PR. The legacy `scripts/verify-*.mjs` were migrated into `test-e2e/`.

## The data root (`.dev-team-agent/`) — the central concept

Every API read/write is scoped to a **`.dev-team-agent/` directory** (the "root"). This folder is owned by the orchestrator plugin, not this repo. Inside it:

- `.dev-state/<task-id>.json` — per-task live state (current_phase, hitl_pending, review_round, …)
- `tasks/<task-id>/*.md` — artifacts produced by each phase (`investigate.md`, `design.md`, `phpstan.md`, `review.md`, `test-spec.md`, `pr-desc.md`, `qa.md`, `*-po.md` doc-review sidecars)
- `pipeline.yaml` — global pipeline override; `tasks/<id>/pipeline.yaml` — per-task override
- `pipeline-profiles/`, `custom-agents/`, `agent-templates/`, `workflow-step-templates/`, `flow-profiles/` — dashboard-managed config the orchestrator/user reuses
- `knowledge.config.yaml` + knowledge store (file driver)

**How the root is resolved (two run modes):**
- **Dev mode** (`vite.config.js` → `devTeamApi` plugin): the root is `cwd/..` (the dashboard is meant to be scaffolded into `.dev-team-agent/viewer/`, so its parent is the data root), overridable via `DEV_TEAM_ROOT`. This is the legacy single-project path.
- **Standalone/multi-project** (`server/standalone.js`): roots come from the **ProjectRegistry** at `~/.dev-team-dashboard/projects.json` (override dir via `DEV_TEAM_DASHBOARD_HOME`). Requests carry `?project=<id>`; no id → default project (DEV_TEAM_ROOT env > registry default > legacy fallback). See `resolveProjectRoot` in `server/registry.js`.

`server/registry.js` is the **single source of truth** for the registry, shared by both the REST API and the MCP server, so projects added from Claude Code (`add_project` tool) and from the UI stay consistent. `validateProjectPath` canonicalizes via `realpathSync` and requires the path to be (or contain) a `.dev-team-agent` dir.

## Architecture

**Backend = one shared request handler, two transports.** `server/devTeamApi.js` exports `createApiHandler(ctx)` returning an `(req,res) => boolean` dispatcher for all `/api/*` routes (returns `false` for non-API paths so the caller falls through to static/next-middleware). It is mounted two ways:
- as a **Vite middleware plugin** (`devTeamApi({root})`) during `pnpm dev`
- by the **standalone HTTP server** (`server/standalone.js`) which also serves `dist/` with SPA fallback

Both build their `ctx` from `createRegistryContext()`. When editing API behavior, edit `devTeamApi.js` once — both modes inherit it.

**The MCP server** (`mcp/server.mjs`) is a separate stdio entrypoint exposing project-registry CRUD (`list_projects`/`get_project`/`add_project`/`remove_project`) to Claude Code. It talks to `server/registry.js` directly and does **not** need the HTTP server running. It is wired up via `.claude/settings.local.json` (`enabledMcpjsonServers`).

**Pipeline config resolution is layered** (`loadPipelineConfig` in `devTeamApi.js`): built-in `DEFAULT_PIPELINE` ← global `pipeline.yaml` (full step replace) ← per-task `tasks/<id>/pipeline.yaml` (patched by step `id`, or full replace when `steps_replace: true` or all ids are new). `DEFAULT_PIPELINE` is a hand-kept JS copy of the orchestrator plugin's `pipeline.default.yaml` — keep the two structurally in sync when phases change.

**The Catalog** (`buildCatalog`) aggregates skills + agents by scanning many sources — enabled installed Claude plugins (`~/.claude/plugins/installed_plugins.json` + `settings.json`), plugin cache, `~/.claude/skills|agents`, `~/.cursor`, repo `marketplace.json` plugins, project `.claude/`, and dashboard-created `custom-agents/`. Results are deduped by `name` using `sourcePriority`. Falls back to `BUILTIN_CATALOG` if nothing is found.

**Agent markdown** round-trips through `src/lib/agentMarkdown.js` (shared by frontend and backend): `parseAgentMarkdown` / `compileAgentMarkdown` / `draftFromAgentMarkdown` / `heuristicDraftFromDescription`. Custom-agent NL generation (`/api/custom-agents/generate`) calls the Anthropic API when `ANTHROPIC_API_KEY` is set, else falls back to the heuristic.

**Knowledge** uses a pluggable driver behind `getKnowledgeDriver(root)` (`server/knowledge/driverRegistry.js`); only the `file` driver exists today, configured by `knowledge.config.yaml` in the root. The REST surface lives in `server/knowledge/knowledgeApi.js`.

**Frontend** (`src/`): `App.vue` is the shell with four modes (monitor / pipeline editor / agent editor / knowledge) and a localStorage-persisted sidebar + project selection. Monitor mode **polls `/api/tasks` every 1500ms**; other modes pause polling. `src/api.js` holds thin `fetch` wrappers for every endpoint and the phase-status derivation logic. Phase status is **inferred from artifact existence** layered with the live cursor (`phaseStatus` in `api.js`) — this mirrors the orchestrator's own rule that status is never encoded, only inferred.

## Conventions observed in this codebase

- ESM throughout (`"type": "module"`); server uses `node:`-prefixed core imports.
- Filesystem reads are defensive by design: helpers like `safeReadDir`, `statSafe`, `readYamlSafe`, `readState` swallow errors and return empty/false rather than throwing, so a half-written state file or missing dir never crashes a request. Preserve this when adding scans.
- All path inputs from requests are sanitized against traversal (`resolveArtifact`, `resolveStatic`, `sanitiseProfileName`, `sanitiseAgentName`, taskId regex) — keep new file-writing endpoints equally strict.
- Registry writes are atomic (temp file + rename in `saveRegistry`).
- `fetchUrlSafe` (used for importing agent templates by URL) enforces https-only and blocks private hostnames — reuse it for any new outbound fetch of user-supplied URLs.
