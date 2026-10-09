// fallow-ignore-file unused-file -- consumer là `controller.ts` qua barrel `business/index.ts`
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
  /** `<root>/pipeline.yaml` có tồn tại hay không; không phải ref. */
  hasGlobalPipeline: boolean
  automations: NlChatCatalogAutomation[]
  /** Nhóm mà nguồn đọc hỏng — khác nhóm rỗng thật. */
  unreadable: NlChatCatalogSection[]
}

export interface NlChatCatalogDeps {
  scanCustomAgents: (root: string) => Promise<any[]>
  scanPatterns?: CatalogScanPatterns | null
}

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

// xem docs/architecture/code/nl-chat.md §2
function textOf(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function skillNamesOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string' && !!s) : []
}

/** Gộp 4 nguồn thành catalog thuần dữ liệu; `deps` do caller inject. */
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

  const unreadable: NlChatCatalogSection[] = [
    ...(catalog.failed ? (['agents', 'skills'] as const) : []),
    ...(pipelineProfiles.failed ? (['pipelineProfiles'] as const) : []),
    ...(automations.failed ? (['automations'] as const) : []),
  ]

  return {
    agents: (catalog.value.agents || [])
      .filter((a: any) => typeof a?.id === 'string' && a.id.length > 0)
      .map((a: any) => ({
        ref: a.id as string,
        name: textOf(a.name),
        source: textOf(a.source),
        description: textOf(a.description),
        skills: skillNamesOf(a.skills),
      })),
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

function clampDesc(desc: string): string {
  const flat = textOf(desc)
  if (flat.length <= DESC_MAX) return flat
  return `${flat.slice(0, DESC_MAX)}…`
}

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
    // xem docs/architecture/code/nl-chat.md §2
    parts.push(
      '- (KHÔNG đọc được nguồn này — ĐỪNG kết luận là không tồn tại. Người dùng nhắc tên thuộc nhóm này thì hỏi lại để họ xác nhận.)',
    )
  } else if (all.length === 0) {
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
    // xem docs/architecture/code/nl-chat.md §2
    parts.push(
      catalog.hasGlobalPipeline
        ? '(Project có pipeline mặc định riêng (`pipeline.yaml`) nhưng nó KHÔNG có ref: muốn dùng thì BỎ TRỐNG `profileName`.)'
        : '(Project chưa có `pipeline.yaml` riêng — BỎ TRỐNG `profileName` sẽ chạy pipeline mặc định dựng sẵn.)',
    )
  }
  return parts.join('\n')
}

/** Khối văn bản bơm vào `extraContext` của một lượt; `entityType` quyết định section nào được in. */
// fallow-ignore-next-line unused-export
export function renderNlChatCatalog(
  catalog: NlChatCatalog,
  entityType?: NlChatEntityType | null,
): string {
  const keys = entityType ? SECTIONS_BY_ENTITY[entityType] : ALL_SECTIONS
  const blocks = ALL_SECTIONS.filter((k) => keys.includes(k)).map((k) => renderSection(catalog, k))
  return [CATALOG_HEADER, '', ...blocks.flatMap((b) => [b, '']), CATALOG_RULES].join('\n')
}
