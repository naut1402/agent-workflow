import type { Context } from 'hono'
import type { HonoEnv } from './types.js'

// Mirror the legacy `json()` helper (shared/http.ts) on the Hono side:
// JSON body + `Cache-Control: no-store` (the dashboard polls; never cache).
export function j(c: Context<HonoEnv>, status: number, body: unknown): Response {
  c.header('Cache-Control', 'no-store')
  return c.json(body as any, status as any)
}

/** 404 used when an explicit ?project=<id> resolves to no known root. */
export function unknownProject(c: Context<HonoEnv>): Response {
  return j(c, 404, { error: 'unknown project', project: c.get('projectId') ?? null })
}

/** Parse a JSON request body, mirroring the manual `JSON.parse(body)` + 400 path. */
export async function parseBody(
  c: Context<HonoEnv>,
): Promise<{ ok: true; value: any } | { ok: false }> {
  try {
    return { ok: true, value: JSON.parse(await c.req.text()) }
  } catch {
    return { ok: false }
  }
}
