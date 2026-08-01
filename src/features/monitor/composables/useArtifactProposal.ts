import { computed, ref } from 'vue'
import { diffLines } from 'diff'
import { fetchProposal, approveJob, discardJob, sendActionFeedback, fetchJob } from '../../runner/RunnerApi'
import { i18n } from '../../../core/i18n'

// Drives ArtifactProposalReview: fetches the before/after of an
// `awaiting_approval` job, exposes a line-diff for rendering, and handles the
// approve / discard / feedback actions. Feedback re-runs the same CLI session
// (server-side, via --resume) and yields a NEW job that itself reaches
// `awaiting_approval`; this composable polls it and swaps to it so the review
// keeps showing the current proposal. Kept separate from the component so the
// poll/diff logic is unit-testable without rendering.

export interface DiffRow {
  type: 'add' | 'del' | 'context'
  text: string
}

export interface UseArtifactProposalOptions {
  initialJobId: string
  pollMs?: number
  maxWaitMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Split a diff chunk into individual lines. `diffLines` keeps the trailing
// newline on each chunk, so a naive split leaves a spurious empty last element —
// drop it, but keep genuine blank lines in the middle.
function toLines(value: string): string[] {
  const lines = value.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function useArtifactProposal(opts: UseArtifactProposalOptions) {
  const pollMs = opts.pollMs ?? 1500
  const maxWaitMs = opts.maxWaitMs ?? 5 * 60 * 1000

  const currentJobId = ref(opts.initialJobId)
  const artifactName = ref('')
  const before = ref('')
  const after = ref('')
  const loading = ref(false)
  const busy = ref(false)
  const statusText = ref('')
  const error = ref<string | null>(null)

  // Normalize CRLF→LF before diffing so a pure line-ending mismatch (common
  // when the real file is CRLF on Windows but the agent writes LF) doesn't make
  // every line show as changed. Only affects the displayed diff — approve still
  // applies the server's raw scratch content (which preserves the real EOL).
  const normalizeEol = (s: string): string => s.replace(/\r\n/g, '\n')

  const diffRows = computed<DiffRow[]>(() => {
    const rows: DiffRow[] = []
    for (const part of diffLines(normalizeEol(before.value), normalizeEol(after.value))) {
      const type: DiffRow['type'] = part.added ? 'add' : part.removed ? 'del' : 'context'
      for (const text of toLines(part.value)) rows.push({ type, text })
    }
    return rows
  })

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const p = await fetchProposal(currentJobId.value)
      artifactName.value = p.artifactName
      before.value = p.before
      after.value = p.after
    } catch (e: any) {
      error.value = String(e?.message || e)
    } finally {
      loading.value = false
    }
  }

  async function approve(): Promise<boolean> {
    busy.value = true
    error.value = null
    statusText.value = i18n.global.t('monitor.proposal.approving')
    try {
      await approveJob(currentJobId.value)
      return true
    } catch (e: any) {
      error.value = String(e?.message || e)
      return false
    } finally {
      busy.value = false
      statusText.value = ''
    }
  }

  async function discard(): Promise<boolean> {
    busy.value = true
    error.value = null
    statusText.value = i18n.global.t('monitor.proposal.discarding')
    try {
      await discardJob(currentJobId.value)
      return true
    } catch (e: any) {
      error.value = String(e?.message || e)
      return false
    } finally {
      busy.value = false
      statusText.value = ''
    }
  }

  // Wait for a freshly-spawned feedback job to settle back at
  // `awaiting_approval` (or surface its failure).
  async function pollUntilAwaiting(jobId: string): Promise<'awaiting_approval' | string> {
    const deadline = Date.now() + maxWaitMs
    for (;;) {
      let status: string | undefined
      try {
        const res = await fetchJob(jobId)
        status = res?.job?.status
      } catch {
        /* transient — retry until deadline */
      }
      if (status === 'awaiting_approval') return 'awaiting_approval'
      if (status === 'failed' || status === 'cancelled' || status === 'succeeded') return status
      if (Date.now() >= deadline) return 'timeout'
      await sleep(pollMs)
    }
  }

  async function sendFeedback(feedback: string): Promise<void> {
    const text = feedback.trim()
    if (!text) {
      error.value = i18n.global.t('monitor.proposal.feedbackRequired')
      return
    }
    busy.value = true
    error.value = null
    statusText.value = i18n.global.t('monitor.proposal.sendingFeedback')
    try {
      const res = await sendActionFeedback(currentJobId.value, text)
      const newJobId: string | undefined = res?.job?.id
      if (!newJobId) throw new Error(i18n.global.t('monitor.proposal.noJobId'))
      statusText.value = i18n.global.t('monitor.proposal.processingFeedback')
      const outcome = await pollUntilAwaiting(newJobId)
      if (outcome !== 'awaiting_approval') {
        error.value =
          outcome === 'timeout'
            ? i18n.global.t('monitor.proposal.feedbackTimeout')
            : i18n.global.t('monitor.proposal.feedbackOutcome', { outcome })
        return
      }
      currentJobId.value = newJobId
      await load()
    } catch (e: any) {
      error.value = String(e?.message || e)
    } finally {
      busy.value = false
      statusText.value = ''
    }
  }

  return {
    currentJobId,
    artifactName,
    before,
    after,
    diffRows,
    loading,
    busy,
    statusText,
    error,
    load,
    approve,
    discard,
    sendFeedback,
  }
}
