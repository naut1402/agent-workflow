import { describe, expect, it, vi } from 'vitest'
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

  it('toggles the dropdown via click/keyboard on the trigger button (no mouse required)', async () => {
    const wrapper = mountWithI18n(FloatingRunningJobsIcon, {
      props: { runningCount: 2, groups: groups(), truncated: false, hiddenTaskCount: 0 },
    })
    const btn = wrapper.find('.floating-running-jobs-btn')
    expect(btn.attributes('aria-expanded')).toBe('false')

    await btn.trigger('click')
    expect(wrapper.find('.floating-running-jobs-dropdown').exists()).toBe(true)
    expect(btn.attributes('aria-expanded')).toBe('true')

    await btn.trigger('click')
    expect(wrapper.find('.floating-running-jobs-dropdown').exists()).toBe(false)
  })

  it('closes on Escape', async () => {
    const wrapper = mountWithI18n(FloatingRunningJobsIcon, {
      props: { runningCount: 2, groups: groups(), truncated: false, hiddenTaskCount: 0 },
    })
    await wrapper.find('.floating-running-jobs-btn').trigger('click')
    expect(wrapper.find('.floating-running-jobs-dropdown').exists()).toBe(true)

    await wrapper.find('.floating-running-jobs').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.floating-running-jobs-dropdown').exists()).toBe(false)
  })

  it('selecting a task via the row button emits select and closes the dropdown', async () => {
    // Listen via an `onSelect` attr instead of `wrapper.emitted()` — in this
    // environment `emitted()` misses custom component emits (a pre-existing
    // quirk also seen on the untouched notifications/NotificationList.test.ts
    // "emits select on item click" case), while a plain listener prop is
    // invoked directly by Vue's runtime emit and is unaffected.
    const onSelect = vi.fn()
    const wrapper = mountWithI18n(FloatingRunningJobsIcon, {
      props: { runningCount: 2, groups: groups(), truncated: false, hiddenTaskCount: 0 },
      attrs: { onSelect },
    })
    await wrapper.find('.floating-running-jobs-btn').trigger('click')
    await wrapper.find('.running-jobs-list-task-row').trigger('click')

    expect(onSelect).toHaveBeenCalledWith('T1')
    expect(wrapper.find('.floating-running-jobs-dropdown').exists()).toBe(false)
  })
})
