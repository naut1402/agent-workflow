import { z } from 'zod'

export const ProjectKind = z.enum(['local', 'git', 'ssh', 'api'])
export type ProjectKind = z.infer<typeof ProjectKind>

export const GitSource = z.object({
  type: z.literal('git'),
  url: z.string().url(),
  branch: z.string().min(1),
  lastSyncAt: z.string().datetime().optional(),
})
export type GitSource = z.infer<typeof GitSource>

export const ProjectRemoteSshSchema = z.object({
  host: z.string().min(1),
  user: z.string().min(1),
  port: z.number().int().positive().default(22),
  runnerId: z.string().min(1),
  artifactCache: z.string().min(1),
  lastSyncedAt: z.string().datetime().optional(),
  lastSyncError: z.string().optional(),
})
export type ProjectRemoteSsh = z.infer<typeof ProjectRemoteSshSchema>

// Bookkeeping cho `kind: 'api'` — tách khỏi `source` (không phải git clone,
// server tự quản lý một artifactCache riêng, dev chủ động push qua HTTP).
export const ProjectApiSyncSchema = z.object({
  lastSyncedAt: z.string().datetime().optional(),
  lastSyncError: z.string().optional(),
})
export type ProjectApiSync = z.infer<typeof ProjectApiSyncSchema>

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  kind: ProjectKind.default('local'),
  path: z.string(),
  addedAt: z.string(),
  default: z.boolean(),
  source: GitSource.optional(),
  remote: ProjectRemoteSshSchema.optional(),
  apiSync: ProjectApiSyncSchema.optional(),
})
export type Project = z.infer<typeof Project>

/** Normalize legacy entry thiếu kind/source/remote/apiSync khi đọc registry. */
export function normalizeProject(raw: unknown): Project {
  const base = Project.safeParse(raw)
  if (base.success) return base.data
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const kind = (['git', 'ssh', 'api'].includes(o.kind as string) ? o.kind : 'local') as ProjectKind
  return Project.parse({
    ...o,
    kind,
    source: kind === 'git' || kind === 'api' ? o.source : undefined,
    remote: kind === 'ssh' ? o.remote : undefined,
    apiSync: kind === 'api' ? o.apiSync : undefined,
  })
}

// Đăng ký 1 project kind 'api'. `sourceUrl`/`branch` thuần tuý phục vụ
// auto-resolve qua GET /api/projects/resolve (giống git-kind); KHÔNG dùng để
// clone — server tự tạo 1 artifactCache rỗng (đối xứng addSshProject).
export const AddApiProjectBodySchema = z.object({
  kind: z.literal('api'),
  name: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  branch: z.string().optional(),
})
export type AddApiProjectBody = z.infer<typeof AddApiProjectBodySchema>

export const AddSshProjectBodySchema = z.object({
  kind: z.literal('ssh'),
  remotePath: z.string().min(1),
  name: z.string().optional(),
  remote: z.object({
    host: z.string().min(1),
    user: z.string().min(1),
    port: z.number().int().positive().default(22),
    runnerId: z.string().min(1),
    artifactCache: z.string().optional(),
  }),
})
export type AddSshProjectBody = z.infer<typeof AddSshProjectBodySchema>

export const AddProjectRequest = z
  .object({
    path: z.string().min(1).optional(),
    gitUrl: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
    name: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    const hasPath = Boolean(v.path?.trim())
    const hasGit = Boolean(v.gitUrl?.trim())
    if (hasPath === hasGit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'exactly one of path or gitUrl is required',
      })
    }
  })

export type AddProjectRequest = z.infer<typeof AddProjectRequest>

export const SyncProjectResponse = z.object({
  project: Project,
  syncedAt: z.string(),
})
export type SyncProjectResponse = z.infer<typeof SyncProjectResponse>

export function parseAddProjectRequest(raw: unknown) {
  return AddProjectRequest.safeParse(raw)
}
