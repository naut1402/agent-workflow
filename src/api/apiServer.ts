import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { HonoEnv, RegistryContext } from '../core/http/types.js'
import { j, json } from '../core/http/responseHelper.js'
import { dirnameFromImportMeta, resolvePath } from '../core/lib/fileHelper.js'
import { loadModulesUnder } from '../core/lib/dirModuleLoader.js'
import { appendRequestLog } from '../core/log/store.js'
import { installEventLogSubscriber } from '../core/log/eventLogSubscriber.js'
import { initLogDriverFromPrefs } from '../core/log/driverInit.js'
import {
  formatRequestQuery,
  formatResponsePreview,
} from '../core/log/schema.js'
import { resolveTraceIdFromRequest, runWithTraceIdAsync } from '../core/log/traceContext.js'
import { createJwtMiddleware } from '../core/http/security/jwtGuard.js'
import { createRateLimitMiddleware } from '../core/http/security/rateLimiter.js'
import { createCorsMiddleware } from '../core/http/security/corsGuard.js'
import { loadSecurityConfig } from '../features/settings/business/dashboardSettings.js'

// ── API server (Hono app + Node bridge) ─────────────────────────────────────
//
// Public contract: createApiHandler(ctx) → async (req,res)=>boolean
// that returns `true` when it produced a response for an /api/* request, and
// `false` for non-api paths (caller falls through to static / next middleware).
//
// Every /api/* request goes through the Hono app via a node→Web Request
// bridge — no feature keeps its own node-res branch above it.
//
// createApp(ctx) builds the Hono instance (exported for tests via app.request).
// Feature routes: moi src/features/<name>/api.ts export registerRoutes +
// optional routeOrder (so nho chay truoc) — nap dong bang loadModulesUnder.

type FeatureApiModule = {
  registerRoutes?: (app: Hono<HonoEnv>) => void
  routeOrder?: number
}

const featuresRoot = resolvePath(dirnameFromImportMeta(import.meta.url), '../features')

/** Đăng ký route từ mọi feature `api.ts`, sắp theo `routeOrder` (mặc định 100). */
export async function registerFeatureRoutes(app: Hono<HonoEnv>): Promise<void> {
  const mods = await loadModulesUnder<FeatureApiModule>(featuresRoot, { entryFile: 'api.ts' })
  if (!mods.length) {
    throw new Error(`registerFeatureRoutes: no features/<name>/api.ts under ${featuresRoot}`)
  }

  const loaded = mods
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
  // Domain events → events.jsonl (prefs-gated). Idempotent across createApp calls.
  installEventLogSubscriber()
  // Switch to the SQLite log driver when configured. Idempotent across createApp calls.
  initLogDriverFromPrefs()

  const app = new Hono<HonoEnv>()

  app.use('/api/*', async (c, next) => {
    const projectId = c.req.query('project') || null
    c.set('ctx', ctx)
    c.set('projectId', projectId)
    c.set('root', ctx.resolveProjectRoot(projectId))
    await next()
  })

  // Thứ tự: CORS (preflight OPTIONS không kèm Authorization) → rate-limit (áp
  // dụng bất kể đã auth chưa) → JWT. Cả 3 no-op mặc định (degrade-by-default).
  app.use('/api/*', createCorsMiddleware(() => loadSecurityConfig().cors))
  app.use('/api/*', createRateLimitMiddleware(() => loadSecurityConfig().rateLimit))
  app.use('/api/*', createJwtMiddleware())

  await registerFeatureRoutes(app)

  app.notFound((c) => j(c, 404, { error: 'unknown endpoint' }))
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse()
    return j(c, 500, { error: String((err as any)?.message ?? err) })
  })

  return app
}

async function nodeToWebRequest(req: IncomingMessage, url: URL): Promise<Request> {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue
    if (Array.isArray(v)) for (const item of v) headers.append(k, item)
    else headers.set(k, String(v))
  }
  // Ghi đè SAU khi copy header gốc — chống client tự set header trùng tên để giả mạo IP.
  headers.set('x-dtd-client-ip', (req.socket as any)?.remoteAddress || 'unknown')
  const method = (req.method || 'GET').toUpperCase()
  let body: Buffer | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    body = chunks.length ? Buffer.concat(chunks) : undefined
  }
  return new Request(url.toString(), { method, headers, body: body as any })
}

function writeWebResponse(res: ServerResponse, status: number, headers: Headers, buf: Buffer): void {
  res.statusCode = status
  headers.forEach((value, key) => res.setHeader(key, value))
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
    // Single chokepoint for ALL /api/* traffic on both transports. Request
    // logging is fire-and-forget in `finally`, never awaited into the response.
    const started = Date.now()
    const projectId = url.searchParams.get('project') || null
    const traceId = resolveTraceIdFromRequest(req)
    return runWithTraceIdAsync(traceId, async () => {
      let errored: string | null = null
      let responsePreview = ''
      const query = formatRequestQuery(url.search)
      try {
        // Set early so clients can correlate even if the handler throws later.
        if (!res.headersSent) res.setHeader('X-Trace-Id', traceId)
        const app = await getApp()
        const response = await app.fetch(await nodeToWebRequest(req, url))
        // Prefer inbound/minted id on the wire (overwrite if Hono also set one).
        const headers = new Headers(response.headers)
        headers.set('X-Trace-Id', traceId)
        const buf = Buffer.from(await response.arrayBuffer())
        responsePreview = formatResponsePreview(buf, headers.get('content-type'))
        writeWebResponse(res, response.status, headers, buf)
      } catch (err: any) {
        errored = String(err && err.message ? err.message : err)
        responsePreview = formatResponsePreview(
          Buffer.from(JSON.stringify({ error: errored })),
          'application/json',
        )
        json(res, 500, { error: errored })
      } finally {
        appendRequestLog({
          method: req.method || 'GET',
          path: url.pathname,
          projectId,
          status: res.statusCode,
          durationMs: Date.now() - started,
          error: errored,
          traceId,
          query,
          response: responsePreview || (errored ? errored : ''),
        })
      }
      return true
    })
  }
}
