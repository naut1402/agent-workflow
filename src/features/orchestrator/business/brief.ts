/**
 * Soạn *brief* — prompt mà orchestrator cấp cho một step, thay cho `request.md`
 * thô. Đây là câu trả lời cho bối cảnh #2 của đề bài: mỗi step là một session
 * CLI mới, không có brief thì node nào cũng phải tự đọc lại repo để dựng lại
 * bối cảnh.
 *
 * Thuần I/O đọc — không ghi file nào (brief đi trong `job.userPrompt`, truy vết
 * được ở job record), nên `MACHINE_FILES` không đổi.
 */

import { joinPath, readDir, readTextFile } from '../../../backend/lib/fileHelper.js'
import { loadKnowledgeBundle } from '../../knowledge/business/index.js'
import { loadPipelineConfig } from '../../pipeline-editor/business/pipeline/index.js'
import { MAX_BRIEF_BYTES } from '../schemas/orchestrator.js'

/** Vì sao step này được gọi — quyết định phần "Việc của bạn" nói gì. */
export type DispatchReason =
  | 'task_created'
  | 'advance'
  | 'agent_start'
  | 'review_retry'
  | 'gate_approved'
  | 'gate_rejected'
  | 'job_failed'
  | 'resume'
  | 'sweep_resume'

export interface StepBriefInput {
  root: string
  taskId: string
  stepId: string
  reason: DispatchReason
  /** Phản hồi gate / verdict reviewer / `job.error` — nguyên văn, không tóm tắt. */
  detail?: string
  /** Phần do agent điều phối soạn. Rỗng ⇒ brief giữ nguyên hình dạng cũ. */
  agentContext?: AgentContext
}

export interface AgentContext {
  /** Tóm tắt bước vừa xong. */
  summary?: string
  /** Bối cảnh agent soạn riêng cho step sắp chạy. */
  context?: string
}

const REASON_TEXT: Record<DispatchReason, string> = {
  task_created: 'Task vừa được tạo — đây là bước đầu tiên.',
  advance: 'Bước trước đã xong, tới lượt bạn.',
  agent_start: 'Node điều phối quyết định chạy bước này.',
  review_retry: 'Reviewer yêu cầu sửa — chạy lại bước này theo verdict bên dưới.',
  gate_approved: 'Cổng HITL đã được duyệt.',
  gate_rejected: 'Cổng HITL bị từ chối — xử lý theo phản hồi bên dưới.',
  job_failed: 'Lượt chạy trước thất bại — xử lý theo lỗi bên dưới.',
  resume: 'Tiếp tục công việc đang dở của bạn theo nội dung bên dưới.',
  sweep_resume: 'Task đang đứng mà không có job nào chạy — nối lại bước này.',
}

async function readExportJson(root: string, taskId: string): Promise<any | null> {
  try {
    return JSON.parse(await readTextFile(joinPath(root, 'tasks', taskId, 'pipeline-export.json')))
  } catch {
    return null
  }
}

/** Vài field cố định, chọn sẵn — brief là tóm tắt, không phải bản sao artifact. */
const EXPORT_FIELDS = ['overall_confidence', 'files_to_modify', 'open_questions', 'entry_points']

function renderExportValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => `  - ${String(v)}`).join('\n')
  return `  ${String(value)}`
}

/**
 * Tóm tắt kết quả các step **trước** `stepId` từ `pipeline-export.json`.
 * Không có file (task cũ, `export_json: false`) ⇒ nói thẳng là chưa có, kèm
 * danh sách artifact `.md` đang tồn tại — degrade rõ ràng, không im lặng.
 */
export function summarizeExport(
  exportJson: any | null,
  steps: any[],
  stepId: string,
  fallbackArtifacts: string[],
): string {
  const idx = steps.findIndex((s: any) => s?.id === stepId)
  const before = idx > 0 ? steps.slice(0, idx) : []

  if (!exportJson?.phases) {
    const list = fallbackArtifacts.length ? fallbackArtifacts.join(', ') : '(chưa có artifact nào)'
    return `⚠️ Chưa có \`pipeline-export.json\`. Artifact hiện có trong thư mục task: ${list}`
  }

  const blocks: string[] = []
  for (const step of before) {
    const phase = exportJson.phases[step?.export_key ?? step?.id]
    if (!phase) continue
    const lines: string[] = []
    for (const field of EXPORT_FIELDS) {
      if (phase[field] == null) continue
      // Mảng rỗng không mang thông tin gì — để lại chỉ tốn chỗ trong ngân sách brief.
      if (Array.isArray(phase[field]) && phase[field].length === 0) continue
      lines.push(`- **${field}**:\n${renderExportValue(phase[field])}`)
    }
    if (lines.length) blocks.push(`### ${step.name || step.id}\n\n${lines.join('\n')}`)
  }
  return blocks.length ? blocks.join('\n\n') : '(các bước trước chưa ghi dữ liệu export)'
}

function renderBundle(bundle: any[]): string {
  if (!bundle?.length) return ''
  return bundle
    .map((entry) =>
      entry.error
        ? `### ${entry.id}\n\n⚠️ ${entry.error}`
        : `### ${entry.title || entry.id}\n\n${entry.content ?? ''}`,
    )
    .join('\n\n')
}

/** Phần agent điều phối soạn, đã chuẩn hoá — rỗng khi pipeline không bật điều phối. */
function agentPart(ctx: AgentContext | undefined, key: keyof AgentContext): string {
  return ctx?.[key]?.trim() ?? ''
}

function renderAssignment(step: any, input: StepBriefInput): string {
  const produces = Array.isArray(step?.produces) && step.produces.length
    ? step.produces.join(', ')
    : '(không có artifact bắt buộc)'
  const lines = [
    `**Bước:** ${step?.name || input.stepId} (\`${input.stepId}\`)`,
    `**Cần tạo:** ${produces}`,
    `**Lý do được gọi:** ${REASON_TEXT[input.reason]}`,
  ]
  // Phản hồi của reviewer / người duyệt đi nguyên văn xuống đây — ĐÂY là kênh
  // giao tiếp giữa hai node mà đề bài yêu cầu, đừng tóm tắt mất chi tiết.
  if (input.detail?.trim()) lines.push(`\n### Nội dung cần xử lý\n\n${input.detail.trim()}`)
  const agentNote = agentPart(input.agentContext, 'context')
  if (agentNote) lines.push(`\n### Bối cảnh từ node điều phối\n\n${agentNote}`)
  return lines.join('\n')
}

const SECTION_CONTEXT = 'Bối cảnh task'
const SECTION_ORCHESTRATOR = 'Tóm tắt của node điều phối'
const SECTION_PREVIOUS = 'Kết quả các bước trước'
const SECTION_KNOWLEDGE = 'Knowledge'

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * Hai nấc ngân sách — không bao giờ cắt im lặng:
 *  1. rút gọn tất định phần "Kết quả các bước trước";
 *  2. gắn nhãn `ĐÃ LƯỢC BỎ` lên đầu và bỏ các mục nặng nhất.
 */
export async function applyBudget(
  parts: { title: string; body: string }[],
  assignment: string,
): Promise<string> {
  const join = (list: { title: string; body: string }[]) =>
    [...list.map((p) => `## ${p.title}\n\n${p.body}`), assignment].join('\n\n')

  let text = join(parts)
  if (byteLength(text) <= MAX_BRIEF_BYTES) return text

  // Nấc 1 — phần export là thứ phình to nhất và cũng là thứ tóm tắt được.
  const trimmed = parts.map((p) =>
    p.title === SECTION_PREVIOUS
      ? { ...p, body: p.body.split('\n').filter((l) => l.startsWith('###') || l.includes('overall_confidence')).join('\n') }
      : p,
  )
  text = join(trimmed)
  if (byteLength(text) <= MAX_BRIEF_BYTES) return text

  // Nấc 2 — bỏ mục nặng, nhưng nói rõ đã bỏ gì.
  const kept: { title: string; body: string }[] = []
  const dropped: string[] = []
  for (const part of trimmed) {
    const candidate = join([...kept, part])
    if (byteLength(candidate) <= MAX_BRIEF_BYTES) kept.push(part)
    else dropped.push(part.title)
  }
  return `⚠️ ĐÃ LƯỢC BỎ: ${dropped.join(', ')}\n\n${join(kept)}`
}

/** Brief đầy đủ cho một step. Ném lỗi khi thiếu `request.md` (task hỏng, không đoán). */
export async function composeStepBrief(input: StepBriefInput): Promise<string> {
  const pipeline = await loadPipelineConfig(input.root, input.taskId)
  const steps = Array.isArray(pipeline.steps) ? pipeline.steps : []
  const step = steps.find((s: any) => s?.id === input.stepId) ?? { id: input.stepId }

  const request = await readTextFile(joinPath(input.root, 'tasks', input.taskId, 'request.md'))
  const exportJson = await readExportJson(input.root, input.taskId)
  const fallbackArtifacts = await listTaskMarkdown(input.root, input.taskId)
  const bundle = await loadKnowledgeBundle(input.root, step.knowledge_inputs ?? [])

  const parts = [
    { title: SECTION_CONTEXT, body: request.trim() },
    { title: SECTION_ORCHESTRATOR, body: agentPart(input.agentContext, 'summary') },
    { title: SECTION_PREVIOUS, body: summarizeExport(exportJson, steps, input.stepId, fallbackArtifacts) },
    { title: SECTION_KNOWLEDGE, body: renderBundle(bundle) },
  ].filter((p) => p.body.trim())

  const assignment = `## Việc của bạn\n\n${renderAssignment(step, input)}`
  return applyBudget(parts, assignment)
}

async function listTaskMarkdown(root: string, taskId: string): Promise<string[]> {
  try {
    return (await readDir(joinPath(root, 'tasks', taskId))).filter((f: string) => f.endsWith('.md'))
  } catch {
    return []
  }
}
