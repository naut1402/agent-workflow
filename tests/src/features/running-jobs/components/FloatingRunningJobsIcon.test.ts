import { describe, expect, it } from 'vitest'
import { mountWithI18n } from '../../../helpers/i18n'
import FloatingRunningJobsIcon from '@/features/running-jobs/components/FloatingRunningJobsIcon.vue'
import type { TaskGroup } from '@/features/running-jobs/lib/groupRunningJobs'

function groups(): TaskGroup[] {
  return [
    {
      taskId: 'T1',
      jobCount: 2,
      steps: [
        {
          stepId: 'implementer',
          jobs: [
            { id: 'j1', status: 'running', metadata: { taskId: 'T1', stepId: 'implementer' } },
            { id: 'j2', status: 'running', metadata: { taskId: 'T1', stepId: 'implementer' } },
          ],
        },
      ],
    },
  ]
}

describe('FloatingRunningJobsIcon', () => {
  it('is hidden when runningCount is 0', () => {
    const wrapper = mountWithI18n(FloatingRunningJobsIcon, {
      props: { runningCount: 0, groups: [], truncated: false, hiddenTaskCount: 0 },
    })
    expect(wrapper.find('.floating-running-jobs').exists()).toBe(false)
  })

  it('shows the badge count when running', () => {
    const wrapper = mountWithI18n(FloatingRunningJobsIcon, {
      props: { runningCount: 2, groups: groups(), truncated: false, hiddenTaskCount: 0 },
    })
    expect(wrapper.find('.floating-running-jobs-badge').text()).toBe('2')
  })

  it('opens the dropdown on mouseenter (hover)', async () => {
    const wrapper = mountWithI18n(FloatingRunningJobsIcon, {
      props: { runningCount: 2, groups: groups(), truncated: false, hiddenTaskCount: 0 },
    })
    expect(wrapper.find('.floating-running-jobs-dropdown').exists()).toBe(false)

    await wrapper.find('.floating-running-jobs').trigger('mouseenter')
    expect(wrapper.find('.floating-running-jobs-dropdown').exists()).toBe(true)
    expect(wrapper.text()).toContain('T1')
    expect(wrapper.text()).toContain('implementer')
  })

  it('caps badge at 9+', () => {
    const wrapper = mountWithI18n(FloatingRunningJobsIcon, {
      props: { runningCount: 12, groups: groups(), truncated: false, hiddenTaskCount: 0 },
    })
    expect(wrapper.find('.floating-running-jobs-badge').text()).toBe('9+')
  })
})
