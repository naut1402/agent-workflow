import { z } from 'zod'

export const ProjectKind = z.enum(['local', 'git'])
export type ProjectKind = z.infer<typeof ProjectKind>

export const GitSource = z.object({
  type: z.literal('git'),
  url: z.string().url(),
  branch: z.string().min(1),
  lastSyncAt: z.string().datetime().optional(),
})
export type GitSource = z.infer<typeof GitSource>

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  kind: ProjectKind.default('local'),
  path: z.string(),
  addedAt: z.string(),
  default: z.boolean(),
  source: GitSource.optional(),
})
export type Project = z.infer<typeof Project>

/** Normalize legacy entry thiếu kind/source khi đọc registry. */
export function normalizeProject(raw: unknown): Project {
  const base = Project.safeParse(raw)
  if (base.success) return base.data
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return Project.parse({
    ...o,
    kind: o.kind ?? 'local',
    source: o.kind === 'git' ? o.source : undefined,
  })
}

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
