/**
 * Port tới kho agent mà catalog đọc nhưng không sở hữu (feature agent-editor).
 * Catalog chỉ biết interface này; adapter dựng ở Facade `PipelineEditorBusiness`.
 */
export interface CatalogAgentStore {
  /** Agent do dashboard quản lý, đã ở dạng item catalog (lô `dashboard`). */
  scanCustomAgents(root: string): Promise<any[]>
  /** Thư mục chứa agent do dashboard quản lý của project. */
  customAgentsDir(root: string): string
  /** Thư mục agent cấp máy (nguồn `user`). */
  userAgentsDir(): string
}
