import { describe, expect, test } from 'bun:test'
import {
  substituteVars,
  substituteVarsInRecord,
  varsSkeletonForStep,
  type AutomationVarsContext,
} from '../../../../src/features/automations/lib/vars.js'

/**
 * vars.ts thuần (không fs) — test trực tiếp substitution + skeleton cho
 * form tooltip.
 */

function makeCtx(): AutomationVarsContext {
  return {
    trigger: {
      kind: 'event',
      type: 'job.failed',
      payload: { projectId: 'p1', jobId: 'j9', error: { message: 'boom' } },
    },
    steps: [
      {
        index: 1,
        taskId: 'Tauto01',
        jobId: 'j1',
        status: 'succeeded',
        stdout: 'Kết quả bước 1',
        artifacts: { design: '## Design' },
      },
    ],
  }
}

describe('substituteVars', () => {
  test('trigger paths', () => {
    const ctx = makeCtx()
    expect(substituteVars('{{trigger.kind}} {{trigger.type}}', ctx)).toBe('event job.failed')
    expect(substituteVars('{{trigger.payload.jobId}}', ctx)).toBe('j9')
  })

  test('steps.N 1-based → stdout / taskId / artifacts', () => {
    const ctx = makeCtx()
    expect(substituteVars('x={{steps.1.stdout}}', ctx)).toBe('x=Kết quả bước 1')
    expect(substituteVars('{{steps.1.taskId}}', ctx)).toBe('Tauto01')
    expect(substituteVars('{{steps.1.artifacts.design}}', ctx)).toBe('## Design')
  })

  test('object value → JSON stringified', () => {
    expect(substituteVars('{{trigger.payload.error}}', makeCtx())).toBe('{"message":"boom"}')
  })

  test('unknown path giữ nguyên literal (dễ nhận ra khi debug)', () => {
    expect(substituteVars('{{steps.9.stdout}} {{nope.x}}', makeCtx())).toBe('{{steps.9.stdout}} {{nope.x}}')
  })

  test('chuỗi không có biến — trả nguyên', () => {
    expect(substituteVars('plain text', makeCtx())).toBe('plain text')
  })
})

describe('substituteVarsInRecord', () => {
  test('chỉ thay các key string chỉ định, bỏ qua field khác', () => {
    const ctx: AutomationVarsContext = {
      trigger: { kind: 'timer', type: 'once', payload: { startAt: '2026-09-01T00:00:00.000Z' } },
      steps: [],
    }
    const action = {
      name: 'Chạy lúc {{trigger.payload.startAt}}',
      mode: 'create',
      prompt: 'Task cho {{trigger.type}}',
      extra: 'giữ nguyên',
    }
    const out = substituteVarsInRecord(action, ['name', 'prompt'], ctx)
    expect(out.name).toBe('Chạy lúc 2026-09-01T00:00:00.000Z')
    expect(out.prompt).toBe('Task cho once')
    expect(out.mode).toBe('create')
    expect(out.extra).toBe('giữ nguyên')
  })
})

describe('varsSkeletonForStep (tooltip form)', () => {
  test('bước 1 chỉ có trigger; bước 2 thấy steps.1', () => {
    const step1 = varsSkeletonForStep(1, false)
    expect(step1.steps).toEqual([])
    expect(step1.trigger.kind).toBe('timer')

    const step2 = varsSkeletonForStep(2, true)
    expect(step2.trigger.kind).toBe('event')
    expect(step2.steps).toHaveLength(1)
    expect(step2.steps[0].stdout).toBeDefined()
    expect(step2.steps[0].artifacts).toBeDefined()
  })
})
