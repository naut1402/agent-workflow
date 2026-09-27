import { describe, expect, it } from 'vitest'
import {
  assemblePipeline,
  extractPipelineMeta,
} from '@/features/pipeline-editor/lib/pipelineRoundTrip'

// TC-01(d): mở pipeline trong editor rồi lưu lại KHÔNG được làm mất khoá nào,
// và khoá `orchestrator` phải đi trọn vòng kể cả khi editor không đụng tới nó.

const FULL = {
  version: 1,
  defaults: { review_retry_max: 2, export_json: false },
  doc_reviewer: { agent: 'a:doc' },
  orchestrator: { enabled: true, agent: 'a:orch' },
  steps: [{ id: 'implementer', name: 'Implement', agent: 'a:impl' }],
}

function roundTrip(pipeline: Record<string, unknown>) {
  return assemblePipeline(extractPipelineMeta(pipeline), (pipeline.steps ?? []) as Record<string, unknown>[])
}

describe('khứ hồi khoá orchestrator', () => {
  it('giữ nguyên enabled + agent', () => {
    expect(roundTrip(FULL).orchestrator).toEqual({ enabled: true, agent: 'a:orch' })
  })

  it('giữ field lạ trong khoá orchestrator (không nuốt cấu hình tương lai)', () => {
    const out = roundTrip({ ...FULL, orchestrator: { enabled: true, agent: 'a:orch', khac: 'giữ lại' } })
    expect(out.orchestrator).toMatchObject({ khac: 'giữ lại' })
  })

  it('pipeline không có khoá orchestrator ⇒ KHÔNG tự mọc khoá mới (TC-03, TC-31)', () => {
    const { orchestrator, ...noOrch } = FULL
    expect(roundTrip(noOrch)).not.toHaveProperty('orchestrator')
  })

  it('không làm mất doc_reviewer / defaults / version', () => {
    const out = roundTrip(FULL)
    expect(out.version).toBe(1)
    expect(out.defaults).toEqual(FULL.defaults)
    expect(out.doc_reviewer).toEqual(FULL.doc_reviewer)
  })

  it('ổn định qua 3 vòng mở/lưu liên tiếp', () => {
    let cur: Record<string, unknown> = FULL
    for (let i = 0; i < 3; i++) cur = roundTrip(cur)
    expect(cur.orchestrator).toEqual({ enabled: true, agent: 'a:orch' })
    expect(cur.steps).toHaveLength(1)
  })

  // Editor bật checkbox = ghi `orchestrator.enabled` vào meta; lưu xong phải
  // thấy đúng trạng thái đó trong YAML, không kèm hiệu ứng phụ nào.
  it('bật checkbox rồi lưu ⇒ chỉ trạng thái đó đổi, export_json giữ nguyên', () => {
    const meta = extractPipelineMeta({ ...FULL, orchestrator: undefined })
    meta.orchestrator = { ...(meta.orchestrator ?? {}), enabled: true }
    const out = assemblePipeline(meta, FULL.steps as Record<string, unknown>[])
    expect(out.orchestrator).toEqual({ enabled: true })
    expect((out.defaults as any).export_json).toBe(false)
  })
})

// T8eb14482 — TC-UI-04/07: `system_prompt`/`knowledge_inputs` (ghi qua dialog
// cấu hình orchestrator ở Pipeline Editor) phải sống sót qua round-trip
// save/export y hệt `enabled`/`agent` — không field mới nào bị lọc bỏ riêng.
describe('khứ hồi system_prompt/knowledge_inputs (T8eb14482)', () => {
  const WITH_NEW_FIELDS = {
    ...FULL,
    orchestrator: {
      enabled: true,
      agent: 'a:orch',
      system_prompt: 'Review có PO thì quay lại implementer.',
      knowledge_inputs: ['global/a', 'project/b'],
    },
  }

  it('giữ nguyên system_prompt + knowledge_inputs qua một vòng mở/lưu', () => {
    expect(roundTrip(WITH_NEW_FIELDS).orchestrator).toEqual({
      enabled: true,
      agent: 'a:orch',
      system_prompt: 'Review có PO thì quay lại implementer.',
      knowledge_inputs: ['global/a', 'project/b'],
    })
  })

  it('ổn định qua 3 vòng mở/lưu liên tiếp', () => {
    let cur: Record<string, unknown> = WITH_NEW_FIELDS
    for (let i = 0; i < 3; i++) cur = roundTrip(cur)
    expect(cur.orchestrator).toMatchObject({
      system_prompt: 'Review có PO thì quay lại implementer.',
      knowledge_inputs: ['global/a', 'project/b'],
    })
  })

  it('knowledge_inputs rỗng ⇒ giữ mảng rỗng, không rụng thành undefined', () => {
    const out = roundTrip({
      ...FULL,
      orchestrator: { enabled: true, agent: 'a:orch', system_prompt: '', knowledge_inputs: [] },
    })
    expect(out.orchestrator).toEqual({ enabled: true, agent: 'a:orch', system_prompt: '', knowledge_inputs: [] })
  })
})

describe('extractPipelineMeta', () => {
  it('sao chép khoá orchestrator, không giữ tham chiếu tới object gốc', () => {
    const src = { ...FULL }
    const meta = extractPipelineMeta(src)
    ;(meta.orchestrator as any).enabled = false
    expect(src.orchestrator.enabled).toBe(true)
  })

  it('đầu vào không phải object ⇒ meta rỗng, không ném', () => {
    for (const raw of [null, undefined, 'chuỗi', 42]) {
      expect(extractPipelineMeta(raw as any)).not.toHaveProperty('orchestrator')
    }
  })
})
