import { splitMarkdownSections, joinMarkdownSections } from './useInlineMarkdownEdit'

export interface QaChoice {
  label: string
  text: string
}

export interface QaBlock {
  /** Position in `splitMarkdownSections(source)` — doubles as its `EditSection` index. */
  index: number
  raw: string
  questionId: string | null
  choices: QaChoice[]
}

const CHOICE_BLOCK_RE = /^\*\*Lựa chọn:\*\*[ \t]*\r?\n((?:^-\s*[A-Z]\.\s.+\r?\n?)+)/m
const CHOICE_ITEM_RE = /^-\s*([A-Z])\.\s*(.+)$/gm
const ANSWER_LINE_RE = /^\*\*Trả lời:\*\*.*$/m

/** Parse `qa.md` into per-question blocks; `choices` is empty for blocks that
 * don't follow the `**Lựa chọn:**` convention (free-text, unchanged behavior). */
export function parseQaBlocks(source: string): QaBlock[] {
  return splitMarkdownSections(source).map((raw, index) => {
    const idMatch = /^##\s*(Q\d+)/.exec(raw)
    const choiceMatch = CHOICE_BLOCK_RE.exec(raw)
    const choices: QaChoice[] = []
    if (choiceMatch) {
      for (const m of choiceMatch[1].matchAll(CHOICE_ITEM_RE)) {
        choices.push({ label: m[1], text: m[2].trim() })
      }
    }
    return { index, raw, questionId: idMatch?.[1] ?? null, choices }
  })
}

/** Write `answerText` into the `**Trả lời:**` line of the given block only. */
export function applyAnswer(source: string, blockIndex: number, answerText: string): string {
  const parts = splitMarkdownSections(source)
  if (blockIndex < 0 || blockIndex >= parts.length) return source
  const block = parts[blockIndex]
  parts[blockIndex] = ANSWER_LINE_RE.test(block)
    ? block.replace(ANSWER_LINE_RE, `**Trả lời:** ${answerText}`)
    : `${block.trimEnd()}\n\n**Trả lời:** ${answerText}\n`
  return joinMarkdownSections(parts)
}
