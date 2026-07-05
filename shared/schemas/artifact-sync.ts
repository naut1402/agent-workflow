import { z } from 'zod'

// Whitelist các đường dẫn được phép sync qua transport HTTP API upload (Luồng
// B). Giống hệt danh sách rsync dùng cho Luồng C (`pullArtifacts()` trong
// `server/workspace/sshSync.ts`), cộng `project-rules.md`. Đây là single
// source of truth cho route, `writeArtifacts()`, và là tài liệu tham chiếu
// cho client (`dashboard-sync.mjs`, thuộc plugin `dev-agent-teams`, PR riêng)
// — client phải mirror whitelist này để không gửi lên file ngoài phạm vi.
export const ARTIFACT_SYNC_ALLOWED_EXACT_FILES = [
  'pipeline.yaml',
  'knowledge.config.yaml',
  'project-rules.md',
] as const

export const ARTIFACT_SYNC_ALLOWED_PREFIXES = ['.dev-state/', 'tasks/', 'knowledge/'] as const

// Các prefix được "mirror" đầy đủ mỗi lần sync — file có trên server nhưng
// không có trong request bị xoá (đối xứng `delete: true` của `pullArtifacts()`
// cho 2 path này ở Luồng C). File/dir tuỳ chọn khác (`ARTIFACT_SYNC_ALLOWED_EXACT_FILES`,
// `knowledge/`) không bị prune nếu vắng mặt trong request.
export const ARTIFACT_SYNC_PRUNE_PREFIXES = ['.dev-state/', 'tasks/'] as const

export function isArtifactPathAllowed(relPath: string): boolean {
  if ((ARTIFACT_SYNC_ALLOWED_EXACT_FILES as readonly string[]).includes(relPath)) return true
  return ARTIFACT_SYNC_ALLOWED_PREFIXES.some((p) => relPath.startsWith(p))
}

export const ArtifactFileSchema = z.object({
  relPath: z.string().min(1).max(500),
  content: z.string().max(5_000_000), // guard ~5MB/file — mọi artifact hiện tại là text nhỏ
})
export type ArtifactFile = z.infer<typeof ArtifactFileSchema>

export const SyncArtifactsRequestSchema = z.object({
  files: z.array(ArtifactFileSchema).min(0).max(2000),
})
export type SyncArtifactsRequest = z.infer<typeof SyncArtifactsRequestSchema>
