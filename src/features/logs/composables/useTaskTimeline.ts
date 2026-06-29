// Pure derivation of a per-task activity timeline from the data already present
// in /api/tasks — artifact mtimes + the live phase cursor + HITL gate. No fetch,
// no Vue: kept pure so it can be unit-tested without rendering (per the
// convention of pulling derived logic out of .vue files).

import { phasesFromPipeline, phaseStatus } from '../../../api/phase'

export interface TimelineEvent {
  ts: number | null
  kind: 'phase' | 'artifact' | 'hitl'
  label: string
  detail?: string
}

export function deriveTimeline(task: any): TimelineEvent[] {
  if (!task) return []
  const events: TimelineEvent[] = []

  // Artifact creation events — concrete timestamps from mtime. Artifacts that
  // don't exist yet (or lack an mtime) are skipped.
  const artifacts = task.artifacts || {}
  for (const [name, meta] of Object.entries(artifacts)) {
    const m = meta as { exists?: boolean; mtime?: number } | null
    if (m && m.exists && typeof m.mtime === 'number') {
      events.push({ ts: m.mtime, kind: 'artifact', label: name, detail: 'tạo artifact' })
    }
  }

  // Live phase cursor — the phase currently running (no fixed timestamp).
  for (const phase of phasesFromPipeline(task.pipeline)) {
    if (phaseStatus(phase, task) === 'active') {
      events.push({ ts: null, kind: 'phase', label: phase.label, detail: 'đang chạy' })
    }
  }

  // HITL gate awaiting human approval.
  if (task.hitl_pending) {
    events.push({ ts: null, kind: 'hitl', label: String(task.hitl_pending), detail: 'chờ duyệt' })
  }

  // Ascending by timestamp; ongoing events (active phase / pending gate) last.
  events.sort((a, b) => {
    if (a.ts == null && b.ts == null) return 0
    if (a.ts == null) return 1
    if (b.ts == null) return -1
    return a.ts - b.ts
  })
  return events
}
