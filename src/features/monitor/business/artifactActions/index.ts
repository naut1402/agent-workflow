import { joinPath, mkdir, rename, writeTextFile } from '../../../../backend/lib/fileHelper.js'
import { dumpYaml, readYamlSafe } from '../../../../backend/lib/yamlLib.js'
import { registryHome } from '../../../../backend/registry.js'
import {
  ArtifactActionsFile,
  type ArtifactAction,
  type ArtifactActionView,
  type ArtifactMenuNode,
} from '../../schemas/artifactAction.js'

// xem docs/architecture/code/monitor.md §18
export const DEFAULT_ARTIFACT_ACTIONS: ArtifactAction[] = [
  {
    id: 'improve-doc',
    label: '✨ Cải thiện tài liệu',
    artifact_patterns: ['investigate.md', 'design.md', 'review.md'],
    // xem docs/architecture/code/monitor.md §18
    agent_ref: '',
    prompt_template: [
      'Cải thiện độ rõ ràng, cấu trúc câu và văn phong tiếng Việt, giữ nguyên ý',
      'nghĩa, thuật ngữ và định dạng markdown.',
      '- Nếu có ĐOẠN TRÍCH ở cuối prompt: chỉ cải thiện đúng đoạn đó.',
      '- Nếu không có đoạn trích: đọc file {{artifact_name}} trong thư mục task',
      '  hiện tại và cải thiện toàn bộ nội dung.',
      'CHỈ IN RA (stdout) nội dung đã cải thiện — không giải thích, không bọc trong',
      'dấu ``` , không thêm gì khác. Không cần ghi file.',
      '',
      'Đoạn trích cần cải thiện (nếu có):',
      '{{selection}}',
    ].join('\n'),
    produces: [],
    confirm: true,
    attach_points: ['artifact-title', 'artifact-selection'],
    require_approval: true,
  },
]

const DEFAULT_CATALOG_VERSION = 1
const DEFAULT_MENUS: ArtifactMenuNode[] = []

function catalogFile(): string {
  return joinPath(registryHome(), 'artifact-actions.yaml')
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
 * given attach point; an action with no `attach_points` counts as title-only.
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
 * `{{selection_lines}}` placeholders; `selection_lines` is `start-end` (or
 * `start`), empty when the line range is unknown.
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

/** Default `attach_points` to title-only when missing or empty. */
export function normalizeAction(a: ArtifactAction): ArtifactAction {
  if (a.attach_points && a.attach_points.length > 0) return a
  return { ...a, attach_points: ['artifact-title'] }
}

function emptyCatalog(): ArtifactActionsFile {
  return {
    version: DEFAULT_CATALOG_VERSION,
    actions: DEFAULT_ARTIFACT_ACTIONS.map(normalizeAction),
    menus: [...DEFAULT_MENUS],
  }
}

/**
 * Load & validate the dashboard-global catalog; falls back to
 * `DEFAULT_ARTIFACT_ACTIONS` when the file is missing, unreadable or invalid.
 */
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
 * Validate + persist a full-catalog replace (`PUT /api/artifact-actions`);
 * rejects an invalid body or duplicate action ids without touching disk.
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
  await mkdir(home, { recursive: true })
  await writeTextFile(tmp, dumpYaml(file))
  await rename(tmp, target)
  return { ok: true, version: file.version, actions, menus }
}
