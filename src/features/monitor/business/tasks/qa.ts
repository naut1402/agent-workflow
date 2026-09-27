import { readTextFile, writeTextFileAtomic } from '../../../../backend/lib/fileHelper.js'
import { CreateQaRequest } from '../../schemas/qa.js'
import type { QaQuestionInput } from '../../schemas/qa.js'
import { resolveArtifact } from './index.js'

const CHOICE_LABELS = 'ABCDEFGHIJ'

function renderQaBlock(n: number, question: QaQuestionInput): string {
  const choiceLines = question.choices.map((choice, i) => `- ${CHOICE_LABELS[i]}. ${choice}`).join('\n')
  return `## Q${n}\n${question.prompt}\n\n**Lựa chọn:**\n${choiceLines}\n\n**Trả lời:**`
}

export type CreateQaResult =
  | { ok: true; path: string; created: number }
  | { ok: false; error: string; details?: unknown }

/**
 * Điểm vào dùng chung cho tạo/bổ sung `qa.md` — gọi từ cả `POST /api/tasks/:id/qa`
 * (dashboard) và MCP tool `create_qa` (agent), theo pattern `loadKnowledgeBundle`.
 * Luôn render đúng khuôn `## Q<n>` / `**Lựa chọn:**` / `**Trả lời:**` bằng code,
 * không phụ thuộc LLM tự soạn markdown tay.
 */
export async function createQa(root: string, taskId: string, input: unknown): Promise<CreateQaResult> {
  const parsed = CreateQaRequest.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid request', details: parsed.error.flatten() }

  // `resolveArtifact` chỉ chặn thoát khỏi `root`, không chặn thoát khỏi
  // `root/tasks/<id>` khi bản thân `id` chứa `..`/`/` (vd `../evil` vẫn "nằm
  // dưới root"). Route HTTP có regex này ở controller, nhưng MCP tool gọi
  // thẳng `createQa()` không đi qua đó — validate ngay tại đây để bất biến
  // "không ghi ra ngoài phạm vi task" áp dụng cho mọi caller như nhau.
  if (!taskId || /[^\w-]/.test(taskId)) return { ok: false, error: 'invalid task id' }

  const target = resolveArtifact(root, taskId, 'qa.md')
  if (!target) return { ok: false, error: 'invalid task id' }

  let existing = ''
  try {
    existing = await readTextFile(target)
  } catch {
    existing = ''
  }

  // Tiếp số từ block Q<n> lớn nhất đang có, kể cả khi file cũ không đúng khuôn
  // (ví dụ được tạo trước khi có `create_qa`) — chỉ cần regex nhận diện heading.
  const existingNumbers = [...existing.matchAll(/^##\s+Q(\d+)/gm)].map((m) => Number(m[1]))
  const startAt = existingNumbers.length ? Math.max(...existingNumbers) : 0

  const newBlocks = parsed.data.questions.map((q, i) => renderQaBlock(startAt + i + 1, q))
  const nextContent = existing.trim()
    ? `${existing.trimEnd()}\n\n${newBlocks.join('\n\n')}\n`
    : `${newBlocks.join('\n\n')}\n`

  await writeTextFileAtomic(target, nextContent)

  return { ok: true, path: target, created: newBlocks.length }
}
