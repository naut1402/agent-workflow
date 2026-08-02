// Last-resort fallback when NO pipeline.yaml exists anywhere (rare: /dev-dashboard
// setup always scaffolds .dev-team-agent/pipeline.yaml). The canonical source of
// the default flow is dev-team-orchestrator/assets/pipeline.default.yaml — this
// JS literal is a self-contained copy because the viewer is copied out of the
// plugin tree into the project and can't read that asset at runtime. Keep the two
// in sync (only the structure matters here; comments live in the YAML).
export const DEFAULT_PIPELINE: any = {
  version: 1,
  defaults: { review_retry_max: 2, auto_review: false, export_json: false },
  steps: [
    { id: 'investigator', name: 'Investigate', agent: 'dev-agent-teams:investigator', produces: ['investigate.md'], export_key: 'investigator', hitl: { mode: 'manual', gate_id: 'hitl-1', optional_doc_review: true } },
    { id: 'designer', name: 'Design', agent: 'dev-agent-teams:designer', produces: ['design.md'], export_key: 'designer', hitl: { mode: 'manual', gate_id: 'hitl-2', optional_doc_review: true } },
    { id: 'implementer', name: 'Implement', agent: 'dev-agent-teams:implementer', produces: ['phpstan.md'], export_key: 'implementer', hitl: { mode: 'none' } },
    { id: 'reviewer', name: 'Review', agent: 'dev-agent-teams:reviewer', produces: ['review.md', 'test-spec.md'], export_key: 'reviewer', hitl: { mode: 'manual', gate_id: 'hitl-3', blocking: true, retry: { on: 'must_fix', restart_from: 'implementer', max: 2 } } },
    { id: 'pr-creator', name: 'PR', agent: 'dev-agent-teams:pr-creator', produces: ['pr-desc.md'], export_key: 'pr_creator', hitl: { mode: 'none' } },
  ],
  doc_reviewer: { agent: 'dev-agent-teams:doc-reviewer', skills: ['doc-review'], rule_category: 'doc-review', rule_required: true },
}

type Step = Record<string, any>

/** Merge one step's fields onto a base step (one level deep for `hitl`). */
export function mergeStep(base: Step, patch: Step): Step {
  const out = { ...base, ...patch }
  if (base.hitl || patch.hitl) out.hitl = { ...(base.hitl || {}), ...(patch.hitl || {}) }
  return out
}

/** Per-task patch: override by `id`, append new ids, drop on `remove: true`. */
export function patchSteps(baseSteps: Step[], patch: Step[]): Step[] {
  const out = baseSteps.map((s) => ({ ...s }))
  for (const p of patch) {
    const idx = out.findIndex((s) => s.id === p.id)
    if (p.remove) {
      if (idx >= 0) out.splice(idx, 1)
      continue
    }
    if (idx >= 0) out[idx] = mergeStep(out[idx], p)
    else out.push(p)
  }
  return out
}

/**
 * Editor saves a full per-task pipeline (steps_replace: true). Hand-written
 * overrides patch by step.id unless every per-task id is new (disjoint from base).
 */
export function perTaskStepsReplace(baseSteps: Step[], per: any): boolean {
  if (per.steps_replace === true) return true
  if (!Array.isArray(per.steps) || per.steps.length === 0) return false
  const baseIds = new Set(baseSteps.map((s) => s.id))
  return !per.steps.some((s: Step) => s.id && baseIds.has(s.id))
}

import { joinPath } from '../../../../core/lib/fileHelper.js'
import { readYamlSafe } from '../../../../core/lib/yamlLib.js'


/**
 * Resolve pipeline config: built-in default ← global pipeline.yaml (full step
 * replace) ← per-task tasks/<id>/pipeline.yaml (patch by id, or full replace).
 */
export async function loadPipelineConfig(root: string, id: string | null): Promise<any> {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_PIPELINE))
  let source = 'builtin'

  const global = await readYamlSafe(joinPath(root, 'pipeline.yaml'))
  if (global) {
    if (Array.isArray(global.steps)) cfg.steps = global.steps
    if (global.defaults) cfg.defaults = { ...cfg.defaults, ...global.defaults }
    if (global.doc_reviewer) cfg.doc_reviewer = { ...cfg.doc_reviewer, ...global.doc_reviewer }
    if (global.version != null) cfg.version = global.version
    source = 'global'
  }

  if (id) {
    const per = await readYamlSafe(joinPath(root, 'tasks', id, 'pipeline.yaml'))
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
