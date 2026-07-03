import { z } from 'zod'

export const SshRunnerConfigSchema = z.object({
  host: z.string().min(1),
  user: z.string().min(1),
  port: z.number().int().positive().default(22),
  remoteCliPath: z.string().default('claude'),
  connectTimeoutMs: z.number().int().positive().default(30_000),
  rsyncTimeoutMs: z.number().int().positive().default(120_000),
  knownHostsFile: z.string().optional(),
  sshBinary: z.string().default('ssh'),
  rsyncBinary: z.string().default('rsync'),
  flags: z.array(z.string()).optional(),
  allowedTools: z.string().optional(),
  dangerouslySkipPermissions: z.boolean().optional(),
})

export const TestSshOkSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
  latencyMs: z.number().int().nonnegative(),
})

export const TestSshFailSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

export const PullCacheOkSchema = z.object({
  ok: z.literal(true),
  lastSyncedAt: z.string().datetime(),
  filesCopied: z.number().int().nonnegative().optional(),
})

export const PullCacheFailSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

export type SshRunnerConfig = z.infer<typeof SshRunnerConfigSchema>
