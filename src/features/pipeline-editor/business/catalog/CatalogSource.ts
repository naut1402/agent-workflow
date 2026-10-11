import type { loadScanPatternsConfig } from '../index.js'
import type { CatalogAgentStore } from './CatalogAgentStore.js'

/** Một lô item catalog do một nguồn quét ra. */
export interface ScanResult {
  skills: any[]
  agents: any[]
}

/** Custom scan patterns lấy từ settings (`ScanPatternsConfig`), được tiêm vào — catalog không tự đọc settings. */
export type CatalogScanPatterns = Partial<ReturnType<typeof loadScanPatternsConfig>>

/** Những gì một nguồn được biết về request hiện tại. */
export interface CatalogContext {
  /** Thư mục `.dev-team-agent/` của project. */
  root: string
  /** Thư mục gốc project — cha của `root`. */
  projectRoot: string
  /** Port tới kho agent; mỗi lời gọi public chỉ cấp phần nó cần. */
  agentStore: Partial<CatalogAgentStore>
  scanPatterns: CatalogScanPatterns | null
}

/**
 * Một nguồn của catalog agent / skill. Nửa quét và nửa resolve path của cùng
 * một nguồn nằm chung một hiện thực, để hai nửa không lệch nhau.
 *
 * Thứ tự các nguồn và chuỗi resolve chỉ khai ở chỗ lắp ráp (`catalog/index.ts`).
 */
export interface CatalogSource {
  /** Độ ưu tiên khi trùng tên — số lớn thắng (`dedupeCatalogItems`). */
  readonly priority: number
  /** Nguồn này có sinh ra item mang trường `source` này không. */
  owns(source: string): boolean
  scan(ctx: CatalogContext): Promise<ScanResult>
  /** Path file agent của item `<source>:<name>`, hoặc null để nhường nguồn kế tiếp. */
  resolveAgentPath?(ctx: CatalogContext, source: string, name: string): Promise<string | null>
  /** Path `SKILL.md` của item `<source>:<name>`; `name` đã được sanitise. */
  resolveSkillPath?(ctx: CatalogContext, source: string, name: string): Promise<string | null>
}
