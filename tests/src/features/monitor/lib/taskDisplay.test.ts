import { describe, expect, it } from 'vitest'
import { taskDisplayName } from '@/features/monitor/lib/taskDisplay'

describe('taskDisplayName', () => {
  it('returns name when present', () => {
    expect(taskDisplayName({ name: 'X', task_id: 'Tabc' })).toBe('X')
  })

  it('falls back to task_id when name is null/blank/missing', () => {
    expect(taskDisplayName({ name: null, task_id: 'Tabc' })).toBe('Tabc')
    expect(taskDisplayName({ name: '  ', task_id: 'Tabc' })).toBe('Tabc')
    expect(taskDisplayName({ task_id: 'Tabc' })).toBe('Tabc')
  })
})
