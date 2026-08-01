import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/runner/RunnerApi', () => ({
  fetchProposal: vi.fn(),
  approveJob: vi.fn(),
  discardJob: vi.fn(),
  sendActionFeedback: vi.fn(),
  fetchJob: vi.fn(),
}))

import { fetchProposal, approveJob, discardJob, sendActionFeedback, fetchJob } from '../../../../../src/features/runner/RunnerApi'
import { useArtifactProposal } from '@/features/monitor/composables/useArtifactProposal'

afterEach(() => vi.clearAllMocks())

describe('useArtifactProposal', () => {
  it('loads the proposal and derives line-diff rows', async () => {
    vi.mocked(fetchProposal).mockResolvedValue({ artifactName: 'design.md', before: 'a\nb\n', after: 'a\nB\n' })
    const p = useArtifactProposal({ initialJobId: 'j1' })

    await p.load()

    expect(fetchProposal).toHaveBeenCalledWith('j1')
    expect(p.artifactName.value).toBe('design.md')
    const rows = p.diffRows.value
    expect(rows).toContainEqual({ type: 'context', text: 'a' })
    expect(rows.some((r) => r.type === 'del' && r.text === 'b')).toBe(true)
    expect(rows.some((r) => r.type === 'add' && r.text === 'B')).toBe(true)
  })

  it('normalizes CRLF vs LF so a pure line-ending mismatch is not shown as an all-changed diff', async () => {
    // before is CRLF (real file on Windows), after is LF (agent wrote LF) but
    // only line 2 actually changed — the diff must show just that one line.
    vi.mocked(fetchProposal).mockResolvedValue({
      artifactName: 'design.md',
      before: 'a\r\nb\r\nc\r\n',
      after: 'a\nB\nc\n',
    })
    const p = useArtifactProposal({ initialJobId: 'j1' })

    await p.load()

    const rows = p.diffRows.value
    expect(rows.filter((r) => r.type === 'del')).toEqual([{ type: 'del', text: 'b' }])
    expect(rows.filter((r) => r.type === 'add')).toEqual([{ type: 'add', text: 'B' }])
    // a and c are unchanged context (not flagged as add/del despite CRLF↔LF).
    expect(rows.some((r) => r.type === 'context' && r.text === 'a')).toBe(true)
    expect(rows.some((r) => r.type === 'context' && r.text === 'c')).toBe(true)
  })

  it('approve() applies the current job', async () => {
    vi.mocked(approveJob).mockResolvedValue({ job: {} })
    const p = useArtifactProposal({ initialJobId: 'j1' })

    expect(await p.approve()).toBe(true)
    expect(approveJob).toHaveBeenCalledWith('j1')
    expect(p.error.value).toBeNull()
  })

  it('discard() discards the current job', async () => {
    vi.mocked(discardJob).mockResolvedValue({ job: {} })
    const p = useArtifactProposal({ initialJobId: 'j1' })

    expect(await p.discard()).toBe(true)
    expect(discardJob).toHaveBeenCalledWith('j1')
  })

  it('surfaces an approve error and returns false', async () => {
    vi.mocked(approveJob).mockRejectedValue(new Error('nope'))
    const p = useArtifactProposal({ initialJobId: 'j1' })

    expect(await p.approve()).toBe(false)
    expect(p.error.value).toBe('nope')
  })

  it('sendFeedback spawns a new job, waits for awaiting_approval, then reloads the diff on it', async () => {
    vi.mocked(sendActionFeedback).mockResolvedValue({ job: { id: 'j2', status: 'queued' } })
    vi.mocked(fetchJob)
      .mockResolvedValueOnce({ job: { id: 'j2', status: 'running' } })
      .mockResolvedValueOnce({ job: { id: 'j2', status: 'awaiting_approval' } })
    vi.mocked(fetchProposal).mockResolvedValue({ artifactName: 'design.md', before: 'x', after: 'y' })
    const p = useArtifactProposal({ initialJobId: 'j1', pollMs: 1 })

    await p.sendFeedback('làm ngắn hơn')

    expect(sendActionFeedback).toHaveBeenCalledWith('j1', 'làm ngắn hơn')
    // Swaps to the new job and refetches its proposal.
    expect(p.currentJobId.value).toBe('j2')
    expect(fetchProposal).toHaveBeenCalledWith('j2')
    expect(p.error.value).toBeNull()
  })

  it('sendFeedback rejects empty feedback without hitting the API', async () => {
    const p = useArtifactProposal({ initialJobId: 'j1' })

    await p.sendFeedback('   ')

    expect(sendActionFeedback).not.toHaveBeenCalled()
    expect(p.error.value).toContain('trống')
  })

  it('sendFeedback surfaces an error when the feedback job fails', async () => {
    vi.mocked(sendActionFeedback).mockResolvedValue({ job: { id: 'j2', status: 'queued' } })
    vi.mocked(fetchJob).mockResolvedValue({ job: { id: 'j2', status: 'failed' } })
    const p = useArtifactProposal({ initialJobId: 'j1', pollMs: 1 })

    await p.sendFeedback('x')

    expect(p.currentJobId.value).toBe('j1') // unchanged — never reached awaiting
    expect(p.error.value).toContain('failed')
  })
})
