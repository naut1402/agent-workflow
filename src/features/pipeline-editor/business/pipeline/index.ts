import path from 'node:path'
import { readYamlSafe } from '../../../../core/lib/yamlLib.js'
import { DEFAULT_PIPELINE } from './default.js'
import { patchSteps, perTaskStepsReplace } from './merge.js'

export { DEFAULT_PIPELINE } from './default.js'
export { mergeStep, patchSteps, perTaskStepsReplace } from './merge.js'

/**
 * Resolve pipeline config: built-in default ← global pipeline.yaml (full step
 * replace) ← per-task tasks/<id>/pipeline.yaml (patch by id, or full replace).
 */
export async function loadPipelineConfig(root: string, id: string | null): Promise<any> {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_PIPELINE))
  let source = 'builtin'

  const global = await readYamlSafe(path.join(root, 'pipeline.yaml'))
  if (global) {
    if (Array.isArray(global.steps)) cfg.steps = global.steps
    if (global.defaults) cfg.defaults = { ...cfg.defaults, ...global.defaults }
    if (global.doc_reviewer) cfg.doc_reviewer = { ...cfg.doc_reviewer, ...global.doc_reviewer }
    if (global.version != null) cfg.version = global.version
    source = 'global'
  }

  if (id) {
    const per = await readYamlSafe(path.join(root, 'tasks', id, 'pipeline.yaml'))
    if (per) {
      if (Array.isArray(per.steps)) {
        if (perTaskStepsReplace(cfg.steps, per)) {
          cfg.steps = per.steps
          source = source === 'global' ? 'global+task-replace' : 'task-replace'
        } else {
          cfg.steps = patchSteps(cfg.steps, per.steps)
          source = source === 'global' ? 'global+task' : 'task'
        }
      }
      if (per.defaults) cfg.defaults = { ...cfg.defaults, ...per.defaults }
      if (per.doc_reviewer) cfg.doc_reviewer = { ...cfg.doc_reviewer, ...per.doc_reviewer }
    }
  }

  cfg.source = source
  return cfg
}

/**
 * Artifacts a pipeline config produces, plus always-present sidecar files
 * (qa.md, and *-po.md doc-review outputs for any *.md artifact).
 */
export function knownArtifactsFor(cfg: any): string[] {
  const set = new Set<string>(['qa.md'])
  for (const step of cfg.steps || []) {
    for (const a of step.produces || []) {
      set.add(a)
      const m = /^(.*)\.md$/.exec(a)
      if (m) set.add(`${m[1]}-po.md`)
    }
  }
  return [...set]
}

/**
 * Sanitize names that become pipeline / flow profile file stems.
 * Rejects path separators and null bytes; strips disallowed chars; caps at 64.
 */
export function sanitiseProfileName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return null
  if (/[\\/\0]/.test(name)) return null
  const clean = name.trim().replace(/[^a-zA-Z0-9_\-. ]/g, '').slice(0, 64)
  return clean || null
}
