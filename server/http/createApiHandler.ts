import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import type { RegistryContext } from '../registry.js'
import { json } from '../../shared/http.js'
import { handleKnowledgeApi } from '../knowledge/knowledgeApi.js'
import { createApp } from './app.js'

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
    try {
      if (url.pathname.startsWith('/api/knowledge')) {
        const projectId = url.searchParams.get('project') || null
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
      json(res, 500, { error: String(err && err.message ? err.message : err) })
    }
    return true
  }
}
