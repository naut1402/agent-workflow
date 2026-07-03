import { z } from 'zod'

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
  env: z.string().min(1).optional(),
})

export type HealthResponse = z.infer<typeof HealthResponseSchema>

