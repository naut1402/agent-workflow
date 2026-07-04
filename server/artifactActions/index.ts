import path from 'node:path'
import { readYamlSafe } from '../../shared/fs.js'
import {
  ArtifactActionsFile,
  type ArtifactAction,
  type ArtifactActionView,
} from '../../shared/schemas/artifactAction.js'
import { DEFAULT_ARTIFACT_ACTIONS } from './default.js'

export { DEFAULT_ARTIFACT_ACTIONS } from './default.js'

// Domain module for artifact quick-actions. Pure + ctx-injected: it takes the
// resolved `.dev-team-agent/` root and knows nothing about HTTP.

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

/** Find a single action by id (null when absent). */
export function findAction(actions: ArtifactAction[], actionId: string): ArtifactAction | null {
  return actions.find((a) => a.id === actionId) ?? null
}

/** Strip the final extension: `design.md` → `design`. */
export function artifactBase(name: string): string {
  return name.replace(/\.[^./\\]+$/, '')
}

/** Substitute `{{artifact_name}}` / `{{artifact_base}}` placeholders in a template. */
export function substitutePrompt(
  template: string,
  vars: { artifact_name: string; artifact_base: string },
): string {
  return template
    .replace(/\{\{\s*artifact_name\s*\}\}/g, vars.artifact_name)
    .replace(/\{\{\s*artifact_base\s*\}\}/g, vars.artifact_base)
}

/** Project an action to its UI-facing subset. */
export function toActionView(a: ArtifactAction): ArtifactActionView {
  return { id: a.id, label: a.label, agent_ref: a.agent_ref, confirm: a.confirm }
}

/**
 * Load & validate `<root>/artifact-actions.yaml`. Falls back to the built-in
 * DEFAULT_ARTIFACT_ACTIONS when the file is missing, unreadable, or fails schema
 * validation — a broken/absent config must never crash a request nor leave the
 * toolbar empty (mirrors the DEFAULT_PIPELINE fallback in `loadPipelineConfig`).
 * A valid YAML fully replaces the default (declarative override).
 */
export async function loadArtifactActions(root: string): Promise<ArtifactAction[]> {
  const raw = await readYamlSafe(path.join(root, 'artifact-actions.yaml'))
  if (!raw) return DEFAULT_ARTIFACT_ACTIONS
  const parsed = ArtifactActionsFile.safeParse(raw)
  if (!parsed.success) return DEFAULT_ARTIFACT_ACTIONS
  return parsed.data.actions
}
