import { phasesFromPipeline, phaseStatus } from '../../../shared/lib/phase'
import { t } from '../../../frontend/plugins/i18n'

export interface TimelineEvent {
  ts: number | null
  kind: 'phase' | 'artifact' | 'hitl'
  label: string
  detail?: string
}

/**
 * Per-task activity timeline from `/api/tasks` data (artifact mtimes, active phase,
 * pending HITL gate), ascending by timestamp with ongoing events last.
 */
export function deriveTimeline(task: any): TimelineEvent[] {
  if (!task) return []
  const events: TimelineEvent[] = []

  const artifacts = task.artifacts || {}
  for (const [name, meta] of Object.entries(artifacts)) {
    const m = meta as { exists?: boolean; mtime?: number } | null
    if (m && m.exists && typeof m.mtime === 'number') {
      events.push({ ts: m.mtime, kind: 'artifact', label: name, detail: t('logs.timeline.artifactDetail') })
    }
  }

  const phases = phasesFromPipeline(task.pipeline)
  const phaseKeys = phases.map((p) => p.key)
  for (const phase of phases) {
    if (phaseStatus(phase, task, phaseKeys) === 'active') {
      events.push({ ts: null, kind: 'phase', label: phase.label, detail: t('logs.timeline.phaseDetail') })
    }
  }

  if (task.hitl_pending) {
    events.push({ ts: null, kind: 'hitl', label: String(task.hitl_pending), detail: t('logs.timeline.hitlDetail') })
  }

  events.sort((a, b) => {
    if (a.ts == null && b.ts == null) return 0
    if (a.ts == null) return 1
    if (b.ts == null) return -1
    return a.ts - b.ts
  })
  return events
}
