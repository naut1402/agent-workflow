import { readTextFile, writeTextFileAtomic } from '../../../../backend/lib/fileHelper.js'
import { CreateQaRequest } from '../../schemas/qa.js'
import type { QaQuestionInput } from '../../schemas/qa.js'
import { resolveArtifact } from './reads.js'

const CHOICE_LABELS = 'ABCDEFGHIJ'

function renderQaBlock(n: number, question: QaQuestionInput): string {
  const choiceLines = question.choices.map((choice, i) => `- ${CHOICE_LABELS[i]}. ${choice}`).join('\n')
  return `## Q${n}\n${question.prompt}\n\n**Lựa chọn:**\n${choiceLines}\n\n**Trả lời:**`
}

export type CreateQaResult =
  | { ok: true; path: string; created: number }
  | { ok: false; error: string; details?: unknown }

/**
 * Tạo/bổ sung các block câu hỏi `## Q<n>` vào `qa.md` của task; dùng chung cho
 * route `POST /api/tasks/:id/qa` và MCP tool `create_qa`.
 */
export async function createQa(root: string, taskId: string, input: unknown): Promise<CreateQaResult> {
  const parsed = CreateQaRequest.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid request', details: parsed.error.flatten() }

  // xem docs/architecture/code/monitor.md §1
  if (!taskId || /[^\w-]/.test(taskId)) {
    return { ok: false, error: `invalid task id — qa.md chỉ nhận [A-Za-z0-9_-]: ${JSON.stringify(taskId)}` }
  }

  const target = resolveArtifact(root, taskId, 'qa.md')
  if (!target) return { ok: false, error: 'invalid task id' }

  let existing = ''
  try {
    existing = await readTextFile(target)
  } catch {
    existing = ''
  }

  const existingNumbers = [...existing.matchAll(/^##\s+Q(\d+)/gm)].map((m) => Number(m[1]))
  const startAt = existingNumbers.length ? Math.max(...existingNumbers) : 0

  const newBlocks = parsed.data.questions.map((q, i) => renderQaBlock(startAt + i + 1, q))
  const nextContent = existing.trim()
    ? `${existing.trimEnd()}\n\n${newBlocks.join('\n\n')}\n`
    : `${newBlocks.join('\n\n')}\n`

  await writeTextFileAtomic(target, nextContent)

  return { ok: true, path: target, created: newBlocks.length }
}
