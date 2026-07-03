import { z } from 'zod'

export const ProjectRemoteSshSchema = z.object({
  host: z.string().min(1),
  user: z.string().min(1),
  port: z.number().int().positive().default(22),
  runnerId: z.string().min(1),
  artifactCache: z.string().min(1),
  lastSyncedAt: z.string().datetime().optional(),
  lastSyncError: z.string().optional(),
})

const ProjectBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  addedAt: z.string(),
  default: z.boolean(),
})

export const ProjectLocalSchema = ProjectBaseSchema.extend({
  kind: z.literal('local'),
  path: z.string(),
})

export const ProjectSshSchema = ProjectBaseSchema.extend({
  kind: z.literal('ssh'),
  path: z.string(),
  remote: ProjectRemoteSshSchema,
})

export const ProjectLegacySchema = ProjectBaseSchema.extend({
  kind: z.string().optional(),
  path: z.string(),
  remote: ProjectRemoteSshSchema.optional(),
}).transform((p) => ({
  ...p,
  kind: (p.kind === 'ssh' ? 'ssh' : 'local') as 'local' | 'ssh',
}))

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

export type ProjectRemoteSsh = z.infer<typeof ProjectRemoteSshSchema>
export type ProjectSsh = z.infer<typeof ProjectSshSchema>
export type AddSshProjectBody = z.infer<typeof AddSshProjectBodySchema>
