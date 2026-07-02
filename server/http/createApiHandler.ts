import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import type { RegistryContext } from '../registry.js'
import { json } from '../../shared/http.js'
import { handleKnowledgeApi } from '../knowledge/knowledgeApi.js'
import { appendRequestLog } from '../logging/store.js'
import { createApp } from './app.js'
import crypto from 'node:crypto'
import { AUTHORIZATION_HEADER, DEV_TEAM_TOKEN_HEADER } from '../../shared/schemas/auth.js'

// ── Node ⇆ Hono bridge ─────────────────────────────────────────────────────
//
// Public contract is unchanged: createApiHandler(ctx) → async (req,res)=>boolean
// that returns `true` when it produced a response for an /api/* request, and
// `false` for non-api paths (caller falls through to static / next middleware).
//
// /api/knowledge is still served by the node-res-based handleKnowledgeApi
// (knowledge module's own HTTP surface); everything else is routed through the
// Hono app via a node→Web Request bridge.

async function nodeToWebRequest(req: IncomingMessage, url: URL): Promise<Request> {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue
    if (Array.isArray(v)) for (const item of v) headers.append(k, item)
    else headers.set(k, String(v))
  }
  const method = (req.method || 'GET').toUpperCase()
  let body: Buffer | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    body = chunks.length ? Buffer.concat(chunks) : undefined
  }
  return new Request(url.toString(), { method, headers, body: body as any })
}

async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  const buf = Buffer.from(await response.arrayBuffer())
  res.end(buf)
}

export function createApiHandler(ctx: RegistryContext) {
  const app = createApp(ctx)

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || '/', 'http://localhost')
    if (!url.pathname.startsWith('/api/')) return false
    // Single chokepoint for ALL /api/* traffic on both transports — the only
    // layer above both the knowledge (node-res) and Hono branches. Request
    // logging is fire-and-forget in `finally`, never awaited into the response.
    const started = Date.now()
    const projectId = url.searchParams.get('project') || null
    let errored: string | null = null
    try {
      // Auth for the node-res knowledge routes (Hono middleware does not run there).
      // When DEV_TEAM_API_TOKEN is unset, behavior stays unchanged (no auth).
      const expected = process.env.DEV_TEAM_API_TOKEN?.trim() || ''
      if (expected && url.pathname !== '/api/health') {
        const authHeader = (req.headers[AUTHORIZATION_HEADER.toLowerCase()] as any) ?? null
        const bearer = typeof authHeader === 'string' ? /^Bearer\s+(.+)\s*$/.exec(authHeader)?.[1] : null
        const tokenHeader = (req.headers[DEV_TEAM_TOKEN_HEADER.toLowerCase()] as any) ?? null
        const raw = typeof tokenHeader === 'string' ? tokenHeader.trim() : ''
        const actual = bearer || raw || null
        const a = actual ? Buffer.from(actual) : null
        const b = Buffer.from(expected)
        const ok = a != null && a.length === b.length && crypto.timingSafeEqual(a, b)
        if (!ok && url.pathname.startsWith('/api/knowledge')) {
          json(res, 401, { error: 'unauthorized' })
          return true
        }
      }

      if (url.pathname.startsWith('/api/knowledge')) {
        const root = ctx.resolveProjectRoot(projectId)
        if (!root) {
          json(res, 404, { error: 'unknown project', project: projectId })
          return true
        }
        await handleKnowledgeApi(req, res, url, root)
        return true
      }
      const response = await app.fetch(await nodeToWebRequest(req, url))
      await writeWebResponse(res, response)
    } catch (err: any) {
      errored = String(err && err.message ? err.message : err)
      json(res, 500, { error: errored })
    } finally {
      appendRequestLog({
        method: req.method || 'GET',
        path: url.pathname,
        projectId,
        status: res.statusCode,
        durationMs: Date.now() - started,
        error: errored,
      })
    }
    return true
  }
}
