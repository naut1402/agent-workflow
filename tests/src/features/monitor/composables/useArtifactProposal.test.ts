import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api', () => ({
  fetchProposal: vi.fn(),
  approveJob: vi.fn(),
  discardJob: vi.fn(),
  sendActionFeedback: vi.fn(),
  fetchJob: vi.fn(),
}))

import { fetchProposal, approveJob, discardJob, sendActionFeedback, fetchJob } from '@/api'
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
