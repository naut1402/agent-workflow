/**
 * `.dev-team-agent/project-rules.md` — hợp đồng file dùng chung giữa CLI
 * orchestrator ngoài (skill `read-project-rules`, ghi file này một lần ở đầu
 * pipeline) và dashboard (đọc lại để nhét rule vào brief). Không tự bịa cơ chế
 * riêng: cùng tên file, cùng format section, để hai đường điều phối hiểu nhau.
 *
 * Thứ tự tìm rule cho một category (khớp skill `read-project-rules`):
 *   1. Section trong `AGENTS.md`/`CLAUDE.md` ở project root (dừng ở file đầu
 *      tiên đọc được).
 *   2. File rule trong `docs/agent-rules/` hoặc `.claude/rules/` (qua
 *      `buildRules` có sẵn).
 *   3. Không tìm thấy → liệt kê ở section "Không tìm thấy", không bịa nội dung.
 */

import {
  dirname,
  joinPath,
  readTextFile,
  writeTextFileAtomic,
} from '../../../backend/lib/fileHelper.js'
import {
  RULE_CATEGORIES,
  buildRules,
  inferRuleCategory,
  resolveRuleContentPath,
} from '../../pipeline-editor/business/rules/index.js'

export const RULE_SECTION_TITLE: Record<string, string> = {
  'coding': 'Rule coding',
  'doc-writing': 'Rule viết tài liệu',
  'doc-review': 'Rule review doc',
  'test': 'Rule test',
  'git-pr': 'Rule git/PR',
}

const ROOT_RULE_FILES = ['AGENTS.md', 'CLAUDE.md']

interface RootRuleSection {
  source: string
  body: string
}

/** Split markdown into `##`/`###` heading sections (heading text → body until next heading). */
function splitHeadingSections(md: string): { heading: string; body: string }[] {
  const lines = md.split('\n')
  const sections: { heading: string; body: string[] }[] = []
  let current: { heading: string; body: string[] } | null = null
  for (const line of lines) {
    const m = /^#{2,3}\s+(.+)$/.exec(line)
    if (m) {
      current = { heading: m[1].trim(), body: [] }
      sections.push(current)
    } else if (current) {
      current.body.push(line)
    }
  }
  return sections.map((s) => ({ heading: s.heading, body: s.body.join('\n').trim() }))
}

/**
 * Rule sections nhúng trực tiếp trong `AGENTS.md`/`CLAUDE.md` ở project root —
 * dừng ở file đầu tiên đọc được (đúng thứ tự ưu tiên của `read-project-rules`).
 * Phân loại heading theo category dùng lại chính `inferRuleCategory` (không
 * định nghĩa keyword mới).
 */
export async function scanRootRuleSections(
  projectRoot: string,
): Promise<Partial<Record<string, RootRuleSection>>> {
  let md: string | null = null
  let fileName = ''
  for (const name of ROOT_RULE_FILES) {
    try {
      md = await readTextFile(joinPath(projectRoot, name))
      fileName = name
      break
    } catch {
      continue
    }
  }
  if (md == null) return {}

  const out: Partial<Record<string, RootRuleSection>> = {}
  for (const { heading, body } of splitHeadingSections(md)) {
    if (!body) continue
    const category = inferRuleCategory(heading, '')
    if (category === 'other' || out[category]) continue
    out[category] = { source: `${fileName}#${heading}`, body }
  }
  return out
}

/**
 * Sinh (idempotent) `.dev-team-agent/project-rules.md`. `root` là thư mục
 * `.dev-team-agent` (cùng tham số `root` mọi nơi khác trong orchestrator).
 * File do CLI ngoài ghi trước thì đọc nguyên văn, không ghi đè — kể cả khi
 * format khác bản dashboard tự sinh.
 */
export async function ensureProjectRulesFile(root: string): Promise<string> {
  const dest = joinPath(root, 'project-rules.md')
  const existing = await readTextFile(dest).catch(() => null)
  if (existing != null) return existing

  const projectRoot = dirname(root)
  const [{ rules }, rootSections] = await Promise.all([
    buildRules(root),
    scanRootRuleSections(projectRoot),
  ])

  const blocks: string[] = ['# Project Convention Rules']
  const notFound: string[] = []
  for (const category of RULE_CATEGORIES) {
    if (category === 'other') continue
    const title = RULE_SECTION_TITLE[category]
    if (!title) continue

    const fromRoot = rootSections[category]
    if (fromRoot) {
      blocks.push(`## ${title}\n**Nguồn**: ${fromRoot.source}\n${fromRoot.body}`)
      continue
    }

    const fromDir = rules.find((r) => r.category === category)
    if (fromDir) {
      const contentPath = resolveRuleContentPath(projectRoot, fromDir.id)
      const content = contentPath ? await readTextFile(contentPath).catch(() => '') : ''
      blocks.push(`## ${title}\n**Nguồn**: ${fromDir.path}\n${content}`)
      continue
    }

    notFound.push(category)
  }
  if (notFound.length) {
    blocks.push(`## Không tìm thấy\n${notFound.map((c) => `- **${c}**: không có`).join('\n')}`)
  }

  const doc = blocks.join('\n\n')
  await writeTextFileAtomic(dest, doc).catch(() => {})
  return doc
}

function extractSection(md: string, title: string): string | null {
  const re = new RegExp(`^##\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm')
  const m = re.exec(md)
  if (!m) return null
  const start = m.index + m[0].length
  const rest = md.slice(start)
  const next = /^##\s+/m.exec(rest)
  return rest.slice(0, next ? next.index : undefined).trim()
}

/**
 * Trích section rule của một category (hoặc nhiều category, gộp bằng `\n\n`)
 * từ nội dung `project-rules.md`. `null` ⇒ caller tự viết "Chưa thiết lập".
 */
export function extractRuleSection(md: string, category: string | string[]): string | null {
  const cats = Array.isArray(category) ? category : [category]
  const found = cats
    .map((c) => RULE_SECTION_TITLE[c])
    .filter((title): title is string => Boolean(title))
    .map((title) => extractSection(md, title))
    .filter((body): body is string => Boolean(body))
  return found.length ? found.join('\n\n') : null
}
