import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Hono } from 'hono'
import type { HonoEnv, RegistryContext } from '../core/http/types.js'
import { j } from '../core/http/respond.js'
import { json } from '../core/contracts/http.js'
import { handleKnowledgeApi } from '../features/knowledge/business/knowledgeApi.js'
import { appendRequestLog } from '../features/logs/business/store.js'

// ── API server (Hono app + Node bridge) ─────────────────────────────────────
//
// Public contract: createApiHandler(ctx) → async (req,res)=>boolean
// that returns `true` when it produced a response for an /api/* request, and
// `false` for non-api paths (caller falls through to static / next middleware).
//
// /api/knowledge is still served by the node-res-based handleKnowledgeApi
// (knowledge module's own HTTP surface); everything else is routed through the
// Hono app via a node→Web Request bridge.
//
// createApp(ctx) builds the Hono instance (exported for tests via app.request).
// Feature routes: mỗi `src/features/<name>/api.ts` export `registerRoutes` +
// optional `routeOrder` (số nhỏ chạy trước). Tự duyệt thư mục — không liệt kê tay.

type FeatureApiModule = {
  registerRoutes?: (app: Hono<HonoEnv>) => void
  routeOrder?: number
}

const featuresRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../features')

async function loadFeatureApis(): Promise<FeatureApiModule[]> {
  const entries = await fs.readdir(featuresRoot, { withFileTypes: true })
  const mods: FeatureApiModule[] = []
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const apiFile = path.join(featuresRoot, ent.name, 'api.ts')
    try {
      await fs.access(apiFile)
    } catch {
      continue
    }
    const mod = (await import(pathToFileURL(apiFile).href)) as FeatureApiModule
    mods.push(mod)
  }
  return mods
}

/** Đăng ký route từ mọi feature `api.ts`, sắp theo `routeOrder` (mặc định 100). */
export async function registerFeatureRoutes(app: Hono<HonoEnv>): Promise<void> {
  const loaded = (await loadFeatureApis())
    .filter(
      (m): m is FeatureApiModule & { registerRoutes: (app: Hono<HonoEnv>) => void } =>
        typeof m.registerRoutes === 'function',
    )
    .map((m) => ({
      order: typeof m.routeOrder === 'number' ? m.routeOrder : 100,
      register: m.registerRoutes,
    }))

  loaded.sort((a, b) => a.order - b.order)
  for (const item of loaded) item.register(app)
}

export async function createApp(ctx: RegistryContext): Promise<Hono<HonoEnv>> {
  const app = new Hono<HonoEnv>()

  app.use('/api/*', async (c, next) => {
    const projectId = c.req.query('project') || null
    c.set('ctx', ctx)
    c.set('projectId', projectId)
    c.set('root', ctx.resolveProjectRoot(projectId))
    await next()
  })

  await registerFeatureRoutes(app)

  app.notFound((c) => j(c, 404, { error: 'unknown endpoint' }))
  app.onError((err, c) => j(c, 500, { error: String((err as any)?.message ?? err) }))

  return app
}

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
  // Lazy init: first /api request awaits feature route registration once.
  // Reset on failure so a transient init error does not pin every later request to 500.
  let appPromise: Promise<Awaited<ReturnType<typeof createApp>>> | null = null
  const getApp = () => {
    if (!appPromise) {
      appPromise = createApp(ctx).catch((err) => {
        appPromise = null
        throw err
      })
    }
    return appPromise
  }

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
      if (url.pathname.startsWith('/api/knowledge')) {
        const root = ctx.resolveProjectRoot(projectId)
        if (!root) {
          json(res, 404, { error: 'unknown project', project: projectId })
          return true
        }
        await handleKnowledgeApi(req, res, url, root)
        return true
      }
      const app = await getApp()
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
