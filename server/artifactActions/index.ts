import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { readYamlSafe } from '../../shared/fs.js'
import { registryHome } from '../registry.js'
import {
  ArtifactActionsFile,
  type ArtifactAction,
  type ArtifactActionView,
  type ArtifactMenuNode,
} from '../../shared/schemas/artifactAction.js'
import { DEFAULT_ARTIFACT_ACTIONS } from './default.js'

export { DEFAULT_ARTIFACT_ACTIONS } from './default.js'

const DEFAULT_CATALOG_VERSION = 1
const DEFAULT_MENUS: ArtifactMenuNode[] = []

// Domain module for artifact quick-actions. Catalog is dashboard-global
// (`~/.dev-team-dashboard/artifact-actions.yaml`, override via
// DEV_TEAM_DASHBOARD_HOME) — shared across projects, like runners.json.
// HTTP routes that *run* an action still need the project `.dev-team-agent/`
// root to resolve the artifact file / agent.

function catalogFile(): string {
  return path.join(registryHome(), 'artifact-actions.yaml')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Match an artifact filename against a pattern. A bare filename matches exactly;
 * a pattern containing `*` is treated as a glob where `*` spans any run of
 * non-separator characters (so `*.md` matches `design.md` but not `sub/x.md`).
 */
export function matchPattern(pattern: string, name: string): boolean {
  if (!pattern || !name) return false
  if (!pattern.includes('*')) return pattern === name
  const rx = '^' + pattern.split('*').map(escapeRegExp).join('[^/\\\\]*') + '$'
  return new RegExp(rx).test(name)
}

/** Filter actions whose patterns match the given artifact filename. */
export function matchActions(actions: ArtifactAction[], artifactName: string): ArtifactAction[] {
  return actions.filter((a) => a.artifact_patterns.some((p) => matchPattern(p, artifactName)))
}

/**
 * Filter actions that both match the artifact filename and are attached to the
 * given attach point (`artifact-title` | `artifact-selection`). An action with
 * no `attach_points` (pre-migration hand-edit) is treated as title-only.
 */
export function matchByAttach(
  actions: ArtifactAction[],
  artifactName: string,
  attachPoint: string,
): ArtifactAction[] {
  return matchActions(actions, artifactName).filter((a) =>
    (a.attach_points ?? ['artifact-title']).includes(attachPoint),
  )
}

/** Find a single action by id (null when absent). */
export function findAction(actions: ArtifactAction[], actionId: string): ArtifactAction | null {
  return actions.find((a) => a.id === actionId) ?? null
}

/** Strip the final extension: `design.md` → `design`. */
export function artifactBase(name: string): string {
  return name.replace(/\.[^./\\]+$/, '')
}

/**
 * Substitute `{{artifact_name}}` / `{{artifact_base}}` / `{{selection}}` /
 * `{{selection_lines}}` placeholders in a template. `selection_lines` is a
 * plain "start-end" (or "start" when they're equal) string, empty when the
 * line range wasn't computed — quick actions that want to always mention it
 * should phrase around a possibly-empty value (e.g. "gần dòng {{selection_lines}}").
 */
export function substitutePrompt(
  template: string,
  vars: {
    artifact_name: string
    artifact_base: string
    selection?: string
    selectionStartLine?: number
    selectionEndLine?: number
  },
): string {
  const lines =
    vars.selectionStartLine != null
      ? vars.selectionStartLine === vars.selectionEndLine
        ? String(vars.selectionStartLine)
        : `${vars.selectionStartLine}-${vars.selectionEndLine ?? vars.selectionStartLine}`
      : ''
  return template
    .replace(/\{\{\s*artifact_name\s*\}\}/g, vars.artifact_name)
    .replace(/\{\{\s*artifact_base\s*\}\}/g, vars.artifact_base)
    .replace(/\{\{\s*selection\s*\}\}/g, vars.selection ?? '')
    .replace(/\{\{\s*selection_lines\s*\}\}/g, lines)
}

/** Project an action to its UI-facing subset. */
export function toActionView(a: ArtifactAction): ArtifactActionView {
  const view: ArtifactActionView = {
    id: a.id,
    label: a.label,
    agent_ref: a.agent_ref,
    confirm: a.confirm,
    attach_points: a.attach_points ?? ['artifact-title'],
    require_approval: a.require_approval ?? false,
  }
  if (a.runner_id) view.runner_id = a.runner_id
  return view
}

/**
 * Fill in `attach_points` for an action loaded from a pre-migration YAML (or a
 * hand-edit that cleared the array): defaults to title-only, matching the
 * historical (pre-QuickAction) behaviour where every action showed on the
 * title toolbar.
 */
export function normalizeAction(a: ArtifactAction): ArtifactAction {
  if (a.attach_points && a.attach_points.length > 0) return a
  return { ...a, attach_points: ['artifact-title'] }
}

/**
 * Load & validate the dashboard-global catalog
 * (`~/.dev-team-dashboard/artifact-actions.yaml`). Falls back to the built-in
 * DEFAULT_ARTIFACT_ACTIONS when the file is missing, unreadable, or fails
 * schema validation — a broken/absent config must never crash a request nor
 * leave the toolbar empty. A valid YAML fully replaces the default
 * (declarative override) — never merged with the built-in seed.
 */
function emptyCatalog(): ArtifactActionsFile {
  return {
    version: DEFAULT_CATALOG_VERSION,
    actions: DEFAULT_ARTIFACT_ACTIONS.map(normalizeAction),
    menus: [...DEFAULT_MENUS],
  }
}

export async function loadArtifactActionsFile(): Promise<ArtifactActionsFile> {
  const raw = await readYamlSafe(catalogFile())
  if (!raw) return emptyCatalog()
  const parsed = ArtifactActionsFile.safeParse(raw)
  if (!parsed.success) return emptyCatalog()
  return {
    version: parsed.data.version,
    actions: parsed.data.actions.map(normalizeAction),
    menus: parsed.data.menus ?? [],
  }
}

/** Convenience wrapper over `loadArtifactActionsFile` for callers that only need the action list. */
export async function loadArtifactActions(): Promise<ArtifactAction[]> {
  return (await loadArtifactActionsFile()).actions
}

export type SaveArtifactActionsResult =
  | { ok: true; version: number; actions: ArtifactAction[]; menus: ArtifactMenuNode[] }
  | { ok: false; error: string }

/**
 * Validate + persist a full-catalog replace (`PUT /api/artifact-actions`).
 * Rejects a schema-invalid body or duplicate action ids without touching disk;
 * on success, writes `registryHome()/artifact-actions.yaml` atomically
 * (temp file + rename), mirroring `saveRunners`.
 * Scope: dashboard-global (shared across projects), not per-project / per-task.
 */
export async function saveArtifactActions(body: unknown): Promise<SaveArtifactActionsResult> {
  const parsed = ArtifactActionsFile.safeParse(body)
  if (!parsed.success) return { ok: false, error: 'invalid request' }

  const actions = parsed.data.actions.map(normalizeAction)
  const menus = parsed.data.menus ?? []
  const seen = new Set<string>()
  for (const a of actions) {
    if (seen.has(a.id)) return { ok: false, error: `duplicate action id: ${a.id}` }
    seen.add(a.id)
  }

  const file: ArtifactActionsFile = { version: parsed.data.version, actions, menus }
  const home = registryHome()
  const target = catalogFile()
  const tmp = `${target}.tmp`
  await fs.mkdir(home, { recursive: true })
  await fs.writeFile(tmp, yaml.dump(file, { lineWidth: 120 }), 'utf8')
  await fs.rename(tmp, target)
  return { ok: true, version: file.version, actions, menus }
}
