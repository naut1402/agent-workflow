import { joinPath, readDir, readFile, readTextFile, resolvePathUnder, statSafe } from '../../../../core/lib/fileHelper.js'
import { knownArtifactsFor, loadPipelineConfig } from '../index.js'

/**
 * Resolve an artifact path under `<root>/tasks/<id>/<name>`.
 * Returns null if the path escapes the task directory (or root).
 */
export function resolveArtifact(root: string, id: string, name: string): string | null {
  const taskDir = resolvePathUnder(root, 'tasks', id)
  if (!taskDir) return null
  return resolvePathUnder(taskDir, name)
}

// pipeline-export.json is machine-readable only — excluded from the UI artifact list.
export const MACHINE_FILES = new Set(['pipeline-export.json'])

/** List a task dir's .md artifacts (+ known not-yet-created ones) and subtask dirs. */
export async function listArtifacts(
  taskDir: string,
  knownArtifacts: string[],
): Promise<{ artifacts: Record<string, any>; subtasks: string[] }> {
  const out: Record<string, any> = {}
  let entries: any[] = []
  try {
    entries = await readDir(taskDir, { withFileTypes: true })
  } catch {
    return { artifacts: out, subtasks: [] }
  }
  const subtasks: string[] = []
  for (const e of entries) {
    if (e.isDirectory()) {
      subtasks.push(e.name)
      continue
    }
    if (MACHINE_FILES.has(e.name)) continue
    if (e.name.endsWith('.md')) {
      const meta = await statSafe(joinPath(taskDir, e.name))
      out[e.name] = { exists: true, mtime: meta.mtime, size: meta.size }
    }
  }
  // Ensure known artifacts always appear (as not-yet-created) for a stable UI.
  for (const name of knownArtifacts) {
    if (!(name in out)) out[name] = { exists: false, mtime: null, size: 0 }
  }
  return { artifacts: out, subtasks }
}

/** Read + JSON-parse a task state file. Returns {ok:false,error} instead of throwing. */
export async function readState(
  stateFile: string,
): Promise<{ ok: true; state: any } | { ok: false; error: string }> {
  try {
    const raw = await readTextFile(stateFile)
    return { ok: true, state: JSON.parse(raw) }
  } catch (err: any) {
    return { ok: false, error: String(err && err.message ? err.message : err) }
  }
}

/** Collect every task (from .dev-state/*.json + tasks/* dirs) with state, artifacts, qa. */
export async function collectTasks(root: string): Promise<any[]> {
  const stateDir = joinPath(root, '.dev-state')
  const tasksDir = joinPath(root, 'tasks')
  const result: any[] = []

  let stateFiles: string[] = []
  try {
    stateFiles = (await readDir(stateDir)).filter((f) => f.endsWith('.json'))
  } catch {
    stateFiles = []
  }

  // Build the set of task ids from state files first, then fold in any task
  // directories that have artifacts but no state yet (e.g. legacy / mid-init).
  const ids = new Set(stateFiles.map((f) => f.replace(/\.json$/, '')))
  try {
    for (const e of await readDir(tasksDir, { withFileTypes: true })) {
      if (e.isDirectory()) ids.add(e.name)
    }
  } catch {
    /* no tasks dir yet */
  }

  for (const id of [...ids].sort()) {
    const stateFile = joinPath(stateDir, `${id}.json`)
    const stateMeta = await statSafe(stateFile)
    const { ok, state, error }: any = stateMeta.exists
      ? await readState(stateFile)
      : { ok: false, state: null, error: 'no state file' }

    const taskDir = joinPath(tasksDir, id)
    const cfg = await loadPipelineConfig(root, id)
    const { artifacts, subtasks } = await listArtifacts(taskDir, knownArtifactsFor(cfg))

    let qa: string | null = null
    let qa_count = 0
    if (artifacts['qa.md'] && artifacts['qa.md'].exists) {
      try {
        qa = await readFile(joinPath(taskDir, 'qa.md'), 'utf8')
        // Count Q&A items: each question starts with a level-2 heading "## Q"
        qa_count = (qa.match(/^##\s+Q\d/gm) || []).length
      } catch {
        qa = null
      }
    }

    result.push({
      task_id: id,
      state_ok: ok,
      state_error: ok ? null : error,
      state_mtime: stateMeta.mtime,
      // Spread known state fields with safe defaults so the UI never crashes on
      // a partially-written file.
      parent_task_id: state?.parent_task_id ?? null,
      current_phase: state?.current_phase ?? null,
      hitl_pending: state?.hitl_pending ?? null,
      review_round: state?.review_round ?? 0,
      auto_review: state?.auto_review ?? false,
      doc_review_round: state?.doc_review_round ?? { investigate: 0, design: 0 },
      inherit_from_parent: state?.inherit_from_parent ?? [],
      export_json: state?.export_json ?? false,
      archived: state?.archived ?? false,
      archived_at: state?.archived_at ?? null,
      artifacts,
      subtasks,
      pipeline: cfg,
      has_qa: !!(artifacts['qa.md'] && artifacts['qa.md'].exists),
      qa_count,
      qa,
    })
  }
  return result
}

/** Path to a task's flow-profile JSON. */
export function flowProfilePath(root: string, id: string): string {
  return joinPath(root, 'flow-profiles', `${id}.json`)
}

export { createTask, renderRequestMarkdown } from './create.js'
export type { CreateTaskInput, CreateTaskResult, CreatedTask } from './create.js'
