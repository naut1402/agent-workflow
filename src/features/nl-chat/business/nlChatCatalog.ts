// fallow-ignore-file unused-file -- consumer là `controller.ts` qua barrel `business/index.ts`
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
 *
 * Khối này được dựng lại ở MỖI lượt chat (`createSession` và `postMessage`
 * của `controller.ts`), không phải snapshot của cả phiên: pipeline/agent tạo
 * ra giữa phiên phải vào được prompt của lượt kế tiếp (design.md T536c80fd).
 */

import { existsSync, joinPath } from '../../../backend/lib/fileHelper.js'
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

/** Nhóm mục trong catalog — đồng thời là đơn vị của `unreadable`. */
export type NlChatCatalogSection = 'pipelineProfiles' | 'agents' | 'skills' | 'automations'

export interface NlChatCatalog {
  agents: NlChatCatalogAgent[]
  skills: NlChatCatalogSkill[]
  /** Tên profile — dùng nguyên văn cho `profileName`. */
  pipelineProfiles: string[]
  /** `<root>/pipeline.yaml` có tồn tại hay không. KHÔNG phải ref (design §3.3). */
  hasGlobalPipeline: boolean
  automations: NlChatCatalogAutomation[]
  /**
   * Nhóm mà nguồn đọc HỎNG, khác hẳn nhóm rỗng thật. Render phải nói ra:
   * im lặng coi nguồn hỏng là rỗng thì builder sẽ khẳng định với người dùng
   * rằng pipeline họ nhắc không tồn tại — đúng triệu chứng đang đi sửa.
   */
  unreadable: NlChatCatalogSection[]
}

export interface NlChatCatalogDeps {
  scanCustomAgents: (root: string) => Promise<any[]>
  scanPatterns?: CatalogScanPatterns | null
}

/**
 * Một nguồn hỏng (quyền đọc, symlink vòng, YAML rác) không được kéo cả catalog
 * xuống — bất biến "đọc filesystem phòng thủ" của AGENTS.md §4.
 */
async function safely<T>(
  load: () => Promise<T> | T,
  fallback: T,
): Promise<{ value: T; failed: boolean }> {
  try {
    return { value: await load(), failed: false }
  } catch {
    return { value: fallback, failed: true }
  }
}

/**
 * Gộp mọi khoảng trắng về một space. Khối catalog là văn bản THEO DÒNG, còn
 * `description`/`name` đến từ frontmatter của file `.md` bên thứ ba
 * (`~/.claude/skills`, plugin cache) — một mô tả nhiều dòng sẽ chèn được dòng
 * `- <ref giả>` nằm ngang hàng mục thật, hoặc cả câu ghi đè khối quy tắc.
 */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function skillNamesOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string' && !!s) : []
}

/**
 * Gộp 4 nguồn thành catalog thuần dữ liệu. `deps` được controller inject —
 * business không tự đọc settings, giống hợp đồng của `buildCatalog`.
 */
// fallow-ignore-next-line unused-export
export async function buildNlChatCatalog(
  root: string,
  deps: NlChatCatalogDeps,
): Promise<NlChatCatalog> {
  const [catalog, pipelineProfiles, automations] = await Promise.all([
    safely(() => buildCatalog(root, deps), { skills: [] as any[], agents: [] as any[] }),
    safely(() => listPipelineProfileNames(root), [] as string[]),
    safely(() => listAutomations(root), [] as any[]),
  ])

  // `buildCatalog` là nguồn chung của cả agent lẫn skill → hỏng thì hỏng cả hai.
  const unreadable: NlChatCatalogSection[] = [
    ...(catalog.failed ? (['agents', 'skills'] as const) : []),
    ...(pipelineProfiles.failed ? (['pipelineProfiles'] as const) : []),
    ...(automations.failed ? (['automations'] as const) : []),
  ]

  return {
    // Item không có `id` bị loại: ref hợp lệ của `steps[].agent` là id đầy đủ
    // (`source:name`), tên trần không resolve được.
    agents: (catalog.value.agents || [])
      .filter((a: any) => typeof a?.id === 'string' && a.id.length > 0)
      .map((a: any) => ({
        ref: a.id as string,
        name: textOf(a.name),
        source: textOf(a.source),
        description: textOf(a.description),
        skills: skillNamesOf(a.skills),
      })),
    // Draft agent ghi `skills[]` bằng TÊN (xem agentMarkdown), không phải ref.
    skills: (catalog.value.skills || [])
      .filter((s: any) => typeof s?.name === 'string' && s.name.length > 0)
      .map((s: any) => ({
        name: s.name as string,
        source: textOf(s.source),
        description: textOf(s.description),
      })),
    pipelineProfiles: pipelineProfiles.value,
    hasGlobalPipeline: existsSync(joinPath(root, 'pipeline.yaml')),
    automations: automations.value
      .filter((r: any) => typeof r?.id === 'string' && r.id.length > 0)
      .map((r: any) => ({ id: r.id as string, name: textOf(r.name), enabled: r.enabled !== false })),
    unreadable,
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

const CATALOG_HEADER = '=== CATALOG HIỆN CÓ TRONG HỆ THỐNG (đọc mới ở lượt này) ==='

const CATALOG_RULES = [
  'QUY TẮC DÙNG CATALOG (bắt buộc, thắng mọi suy đoán):',
  '1. Người dùng nhắc tên một pipeline / agent / skill → đối chiếu danh sách trên và điền NGUYÊN VĂN giá trị khớp.',
  '2. Không có mục nào khớp → KHÔNG chốt draft. Hỏi lại người dùng, kèm tối đa 5 tên gần nhất trong catalog.',
  '3. Khớp mơ hồ (từ 2 mục trở lên) → hỏi người dùng chọn, KHÔNG tự đoán.',
  '4. KHÔNG bịa ref và KHÔNG tự suy ref từ tên trần: `investigator` không phải ref hợp lệ, ref đầy đủ luôn có tiền tố nguồn.',
  '5. Danh sách trên được cấp LẠI ở mỗi lượt và luôn là trạng thái mới nhất tại thời điểm này — MỌI khối catalog xuất hiện ở các lượt TRƯỚC đã hết hiệu lực, KHÔNG được lấy ref từ chúng (mục biến mất khỏi danh sách mới nghĩa là nó đã bị xoá hoặc đổi tên). Người dùng khẳng định có đối tượng mới hơn mà danh sách không có → nói rõ bạn vừa đọc lại và vẫn không thấy nó, hỏi lại tên chính xác, KHÔNG tự điền.',
].join('\n')

/** Section nào thật sự được draft của từng `entityType` tham chiếu tới. */
type SectionKey = NlChatCatalogSection

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

/**
 * Mô tả dài làm phình prompt mà không thêm thông tin phân biệt — cắt ở
 * `DESC_MAX`. Gộp khoảng trắng lần nữa ở đây (dù `buildNlChatCatalog` đã làm)
 * vì nửa render là hàm thuần, gọi được với catalog do người khác dựng.
 */
function clampDesc(desc: string): string {
  const flat = textOf(desc)
  if (flat.length <= DESC_MAX) return flat
  return `${flat.slice(0, DESC_MAX)}…`
}

/**
 * `- <ref>` khi không có mô tả: dấu `—` treo lủng làm model tưởng mô tả bị mất.
 * `label` cũng đi qua `textOf`: `ref`/`name` đến từ file bên thứ ba như
 * `description`, nên cùng đường chèn dòng giả.
 */
function bullet(label: string, desc: string): string {
  const clamped = clampDesc(desc)
  return clamped ? `- ${textOf(label)} — ${clamped}` : `- ${textOf(label)}`
}

function linesOf(catalog: NlChatCatalog, key: SectionKey): string[] {
  switch (key) {
    case 'pipelineProfiles':
      return catalog.pipelineProfiles.map((name) => `- ${textOf(name)}`)
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
  if (catalog.unreadable.includes(key)) {
    // Nguồn hỏng KHÁC nguồn rỗng. Nói "chưa có mục nào" ở đây là để builder
    // khẳng định pipeline người dùng nhắc không tồn tại, rồi bỏ trống
    // `profileName` → task rơi về pipeline mặc định, đúng bug đang đi sửa.
    parts.push(
      '- (KHÔNG đọc được nguồn này — ĐỪNG kết luận là không tồn tại. Người dùng nhắc tên thuộc nhóm này thì hỏi lại để họ xác nhận.)',
    )
  } else if (all.length === 0) {
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
    parts.push(
      catalog.hasGlobalPipeline
        ? '(Project có pipeline mặc định riêng (`pipeline.yaml`) nhưng nó KHÔNG có ref: muốn dùng thì BỎ TRỐNG `profileName`.)'
        : '(Project chưa có `pipeline.yaml` riêng — BỎ TRỐNG `profileName` sẽ chạy pipeline mặc định dựng sẵn.)',
    )
  }
  return parts.join('\n')
}

/**
 * Khối văn bản bơm vào `extraContext` của MỘT lượt bất kỳ. `entityType` quyết định
 * section nào được in — draft `agent` chỉ tham chiếu skill nên không cần
 * gánh cả danh sách pipeline.
 */
// fallow-ignore-next-line unused-export
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
