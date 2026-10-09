/** Draft phẳng do dialog chỉnh sửa — mỗi field bind trực tiếp vào một control. */
export type StepConfigDraft = {
  name: string
  agent: string
  produces: string[]
  hitl_mode: string
  hitl_gate_id: string
  hitl_optional_doc_review: boolean
  hitl_blocking: boolean
  knowledge_inputs: string[]
  /** Runner pin cho step — '' = theo mặc định hệ thống. */
  runner_id: string
}

/** Payload gửi qua emit `update` — khớp `data` của node canvas. */
export type StepConfigUpdate = {
  label: string
  agent: string
  produces: string[]
  knowledge_inputs: string[]
  hitl: Record<string, unknown>
  /** Luôn có mặt, kể cả '' (gỡ pin) — xem docs/architecture/code/pipeline-editor.md §4. */
  runner_id: string
}

/** `null` khi chưa chọn node — dialog dùng chính giá trị này để quyết định render. */
export function buildStepConfigDraft(step: any): StepConfigDraft | null {
  if (!step) return null
  const hitl = step.hitl || {}
  return {
    name: step.label || '',
    agent: step.agent || '',
    produces: [...(step.produces || [])],
    hitl_mode: hitl.mode || 'none',
    hitl_gate_id: hitl.gate_id || '',
    hitl_optional_doc_review: hitl.optional_doc_review ?? false,
    hitl_blocking: hitl.blocking ?? false,
    knowledge_inputs: [...(step.knowledge_inputs || [])],
    runner_id: step.runner_id || '',
  }
}

/** Mode `none` chỉ ghi lại `{ mode }` — các subfield khác vô nghĩa khi không có gate. */
export function buildHitlFromDraft(draft: StepConfigDraft, stepId: string): Record<string, unknown> {
  if (draft.hitl_mode === 'none') return { mode: 'none' }
  return {
    mode: draft.hitl_mode,
    gate_id: draft.hitl_gate_id || `hitl-${stepId}`,
    optional_doc_review: draft.hitl_optional_doc_review,
    blocking: draft.hitl_blocking,
  }
}

export function buildStepUpdateFromDraft(draft: StepConfigDraft, stepId: string): StepConfigUpdate {
  return {
    label: draft.name,
    agent: draft.agent,
    produces: draft.produces,
    knowledge_inputs: draft.knowledge_inputs,
    hitl: buildHitlFromDraft(draft, stepId),
    runner_id: draft.runner_id,
  }
}
