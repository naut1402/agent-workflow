/**
 * Catalog "những gì đang có trong hệ thống" cho agent `nl-chat-builder`.
 *
 * Tách đôi có chủ đích (design.md Tf2fec630 §4.2):
 * - `buildNlChatCatalog` — **nửa dữ liệu**: gộp 4 nguồn đã có sẵn trên server,
 *   trả object JSON-serializable, KHÔNG cap, KHÔNG cắt chữ. Tiến trình khác
 *   (vd tool MCP về sau) dùng lại được nguyên trạng.
 * - `renderNlChatCatalog` — **nửa prompt**: lọc theo `entityType`, cap số mục,
 *   cắt mô tả, ghép khối "quy tắc dùng catalog".
 *
 * Vì sao bơm vào prompt thay vì để agent tự đọc đĩa: workspace của một phiên
 * chat là `nlchat-scratch/<id>` (không thấy `pipeline-profiles/`), và 2 provider
 * API thuần không có tool nào — prompt là đường duy nhất chạy được với mọi
 * runner.
 */

import { existsSync, joinPath } from '../../../core/lib/fileHelper.js'
import type { NlChatEntityType } from './nlChatSession.js'
import {
  buildCatalog,
  listPipelineProfileNames,
  listAutomations,
  type CatalogScanPatterns,
} from './index.js'

export interface NlChatCatalogAgent {
  /** Ref đầy đủ dạng `source:name` — giá trị duy nhất hợp lệ cho `steps[].agent`. */
  ref: string
  name: string
  source: string
  description: string
  skills: string[]
}

export interface NlChatCatalogSkill {
  name: string
  source: string
  description: string
}

export interface NlChatCatalogAutomation {
  id: string
  name: string
  enabled: boolean
}

export interface NlChatCatalog {
  agents: NlChatCatalogAgent[]
  skills: NlChatCatalogSkill[]
  /** Tên profile — dùng nguyên văn cho `profileName`. */
  pipelineProfiles: string[]
  /** `<root>/pipeline.yaml` có tồn tại hay không. KHÔNG phải ref (design §3.3). */
  hasGlobalPipeline: boolean
  automations: NlChatCatalogAutomation[]
}

export interface NlChatCatalogDeps {
  scanCustomAgents: (root: string) => Promise<any[]>
  scanPatterns?: CatalogScanPatterns | null
}

/**
 * Một nguồn hỏng (quyền đọc, symlink vòng, YAML rác) không được kéo cả catalog
 * xuống — bất biến "đọc filesystem phòng thủ" của AGENTS.md §4.
 */
async function safely<T>(load: () => Promise<T> | T, fallback: T): Promise<T> {
  try {
    return await load()
  } catch {
    return fallback
  }
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function skillNamesOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string' && !!s) : []
}

/**
 * Gộp 4 nguồn thành catalog thuần dữ liệu. `deps` được controller inject —
 * business không tự đọc settings, giống hợp đồng của `buildCatalog`.
 */
export async function buildNlChatCatalog(
  root: string,
  deps: NlChatCatalogDeps,
): Promise<NlChatCatalog> {
  const [catalog, pipelineProfiles, automations] = await Promise.all([
    safely(() => buildCatalog(root, deps), { skills: [] as any[], agents: [] as any[] }),
    safely(() => listPipelineProfileNames(root), [] as string[]),
    safely(() => listAutomations(root), [] as any[]),
  ])

  return {
    // Item không có `id` bị loại: ref hợp lệ của `steps[].agent` là id đầy đủ
    // (`source:name`), tên trần không resolve được.
    agents: (catalog.agents || [])
      .filter((a: any) => typeof a?.id === 'string' && a.id.length > 0)
      .map((a: any) => ({
        ref: a.id as string,
        name: textOf(a.name),
        source: textOf(a.source),
        description: textOf(a.description),
        skills: skillNamesOf(a.skills),
      })),
    // Draft agent ghi `skills[]` bằng TÊN (xem agentMarkdown), không phải ref.
    skills: (catalog.skills || [])
      .filter((s: any) => typeof s?.name === 'string' && s.name.length > 0)
      .map((s: any) => ({
        name: s.name as string,
        source: textOf(s.source),
        description: textOf(s.description),
      })),
    pipelineProfiles,
    hasGlobalPipeline: existsSync(joinPath(root, 'pipeline.yaml')),
    automations: automations
      .filter((r: any) => typeof r?.id === 'string' && r.id.length > 0)
      .map((r: any) => ({ id: r.id as string, name: textOf(r.name), enabled: r.enabled !== false })),
  }
}

// ── render ────────────────────────────────────────────────────────────────

/**
 * Trần số mục mỗi section. `buildCatalog` quét `~/.claude/skills`, plugin cache
 * và `.claude/` của project nên số mục có thể hàng trăm — cap ở đây, KHÔNG sửa
 * `buildCatalog` (dùng chung với `GET /api/catalog`).
 */
const CAPS = { agents: 60, skills: 80, pipelineProfiles: 50, automations: 30 }
const DESC_MAX = 100

const CATALOG_HEADER = '=== CATALOG HIỆN CÓ TRONG HỆ THỐNG (chụp lúc mở phiên chat) ==='

const CATALOG_RULES = [
  'QUY TẮC DÙNG CATALOG (bắt buộc, thắng mọi suy đoán):',
  '1. Người dùng nhắc tên một pipeline / agent / skill → đối chiếu danh sách trên và điền NGUYÊN VĂN giá trị khớp.',
  '2. Không có mục nào khớp → KHÔNG chốt draft. Hỏi lại người dùng, kèm tối đa 5 tên gần nhất trong catalog.',
  '3. Khớp mơ hồ (từ 2 mục trở lên) → hỏi người dùng chọn, KHÔNG tự đoán.',
  '4. KHÔNG bịa ref và KHÔNG tự suy ref từ tên trần: `investigator` không phải ref hợp lệ, ref đầy đủ luôn có tiền tố nguồn.',
  '5. Danh sách này chụp lúc mở phiên. Người dùng khẳng định có đối tượng mới hơn → nói rõ bạn không thấy nó và đề nghị mở phiên chat mới, KHÔNG tự điền.',
].join('\n')

/** Section nào thật sự được draft của từng `entityType` tham chiếu tới. */
type SectionKey = 'pipelineProfiles' | 'agents' | 'skills' | 'automations'

const SECTIONS_BY_ENTITY: Record<NlChatEntityType, SectionKey[]> = {
  task: ['pipelineProfiles', 'agents'],
  pipeline: ['agents', 'skills'],
  agent: ['skills'],
  automation: ['pipelineProfiles', 'automations'],
}

const ALL_SECTIONS: SectionKey[] = ['pipelineProfiles', 'agents', 'skills', 'automations']

const SECTION_HEADERS: Record<SectionKey, string> = {
  pipelineProfiles: '[PIPELINE PROFILE] — giá trị hợp lệ của field `profileName`, dùng NGUYÊN VĂN:',
  agents: '[AGENT] — giá trị hợp lệ của `steps[].agent`, dùng NGUYÊN VĂN cả tiền tố nguồn:',
  skills: '[SKILL] — giá trị hợp lệ của `skills[]` (dùng tên, KHÔNG có tiền tố nguồn):',
  automations: '[AUTOMATION RULE ĐANG CÓ] — chỉ để tránh tạo trùng, KHÔNG phải ref:',
}

/** Mô tả dài làm phình prompt mà không thêm thông tin phân biệt — cắt ở `DESC_MAX`. */
function clampDesc(desc: string): string {
  if (desc.length <= DESC_MAX) return desc
  return `${desc.slice(0, DESC_MAX)}…`
}

/** `- <ref>` khi không có mô tả: dấu `—` treo lủng làm model tưởng mô tả bị mất. */
function bullet(label: string, desc: string): string {
  const clamped = clampDesc(desc)
  return clamped ? `- ${label} — ${clamped}` : `- ${label}`
}

function linesOf(catalog: NlChatCatalog, key: SectionKey): string[] {
  switch (key) {
    case 'pipelineProfiles':
      return catalog.pipelineProfiles.map((name) => `- ${name}`)
    case 'agents':
      return catalog.agents.map((a) => bullet(a.ref, a.description))
    case 'skills':
      return catalog.skills.map((s) => bullet(s.name, s.description))
    case 'automations':
      return catalog.automations.map((r) =>
        bullet(r.id, r.name ? `${r.name} (${r.enabled ? 'đang bật' : 'đang tắt'})` : ''),
      )
  }
}

function renderSection(catalog: NlChatCatalog, key: SectionKey): string {
  const parts = [SECTION_HEADERS[key]]
  const all = linesOf(catalog, key)
  if (all.length === 0) {
    // Phân biệt "không có mục nào" với "không được cho biết" — im lặng thì
    // model tự do suy diễn, đúng cái task này đi sửa.
    parts.push('- (chưa có mục nào)')
  } else {
    const cap = CAPS[key]
    parts.push(...all.slice(0, cap))
    if (all.length > cap) {
      parts.push(
        `(còn ${all.length - cap} mục bị lược — nếu tên người dùng nhắc không có ở trên, hãy hỏi lại thay vì đoán.)`,
      )
    }
  }
  if (key === 'pipelineProfiles') {
    // KHÔNG in ref `@global`: `sanitiseProfileName('@global')` → `global` →
    // đọc `pipeline-profiles/global.yaml` không thấy → task âm thầm rơi về
    // pipeline mặc định (design §3.3).
    parts.push('(Pipeline mặc định của project KHÔNG có ref: muốn dùng nó thì BỎ TRỐNG `profileName`.)')
  }
  return parts.join('\n')
}

/**
 * Khối văn bản bơm vào `extraContext` của lượt 1. `entityType` quyết định
 * section nào được in — draft `agent` chỉ tham chiếu skill nên không cần
 * gánh cả danh sách pipeline.
 */
export function renderNlChatCatalog(
  catalog: NlChatCatalog,
  entityType?: NlChatEntityType | null,
): string {
  const keys = entityType ? SECTIONS_BY_ENTITY[entityType] : ALL_SECTIONS
  const blocks = ALL_SECTIONS.filter((k) => keys.includes(k)).map((k) => renderSection(catalog, k))
  // Khối rule luôn đi kèm, kể cả khi mọi section rỗng — đó là lúc rule #2
  // (không khớp thì hỏi lại) quan trọng nhất.
  return [CATALOG_HEADER, '', ...blocks.flatMap((b) => [b, '']), CATALOG_RULES].join('\n')
}
