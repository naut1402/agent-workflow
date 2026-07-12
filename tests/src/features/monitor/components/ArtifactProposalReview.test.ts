import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('@/api', () => ({
  fetchProposal: vi.fn(async () => ({ artifactName: 'design.md', before: 'old line\n', after: 'new line\n' })),
  approveJob: vi.fn(async () => ({ job: {} })),
  discardJob: vi.fn(async () => ({ job: {} })),
  sendActionFeedback: vi.fn(),
  fetchJob: vi.fn(),
}))

import { approveJob, discardJob } from '@/api'
import ArtifactProposalReview from '@/features/monitor/components/ArtifactProposalReview.vue'

function mountReview() {
  return mount(ArtifactProposalReview, {
    props: { jobId: 'j1', artifactName: 'design.md' },
    // Render the Teleport content inline so we can assert on it.
    global: { stubs: { teleport: true } },
  })
}

afterEach(() => vi.clearAllMocks())

describe('ArtifactProposalReview', () => {
  it('renders the proposed diff (added + removed lines)', async () => {
    const w = mountReview()
    await flushPromises()
    expect(w.find('.diff-add').exists()).toBe(true)
    expect(w.find('.diff-del').exists()).toBe(true)
    expect(w.text()).toContain('new line')
    expect(w.text()).toContain('old line')
  })

  it('approves and emits "approved"', async () => {
    const w = mountReview()
    await flushPromises()
    await w.get('.proposal-actions .btn-primary').trigger('click')
    await flushPromises()
    expect(approveJob).toHaveBeenCalledWith('j1')
    expect(w.emitted('approved')).toBeTruthy()
  })

  it('discards and emits "discarded"', async () => {
    const w = mountReview()
    await flushPromises()
    await w.get('.proposal-actions .btn-danger').trigger('click')
    await flushPromises()
    expect(discardJob).toHaveBeenCalledWith('j1')
    expect(w.emitted('discarded')).toBeTruthy()
  })
})
