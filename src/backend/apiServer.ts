import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { HonoEnv, RegistryContext } from './http/types.js'
import { j, json } from './http/responseHelper.js'
import { dirnameFromImportMeta, resolvePath } from './lib/fileHelper.js'
import { loadModulesUnder } from './lib/dirModuleLoader.js'
import { appendRequestLog } from './log/store.js'
import { installEventLogSubscriber } from './log/eventLogSubscriber.js'
import { initLogDriverFromPrefs } from './log/driverInit.js'
import {
  formatRequestQuery,
  formatResponsePreview,
} from '../shared/log/schema.js'
import { resolveTraceIdFromRequest, runWithTraceIdAsync } from './log/traceContext.js'
import { createJwtMiddleware } from './http/security/jwtGuard.js'
import { createRateLimitMiddleware } from './http/security/rateLimiter.js'
import { createCorsMiddleware } from './http/security/corsGuard.js'
import { loadSecurityConfig } from '../features/settings/business/dashboardSettings.js'

// createApiHandler(ctx) is the single entrypoint for /api/* on both transports
// — no feature keeps its own node-res branch above it. See docs/architecture.md §2.

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

  // Thứ tự bắt buộc: CORS → rate-limit (áp dụng cả khi chưa auth) → JWT; cả 3 no-op mặc định.
  app.use('/api/*', createCorsMiddleware(() => loadSecurityConfig().cors))
  app.use('/api/*', createRateLimitMiddleware(() => loadSecurityConfig().rateLimit))
  // Route orchestrator dùng token riêng theo job (không phải Authorization) nên loại khỏi JWT dashboard.
  const jwtMiddleware = createJwtMiddleware()
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/orchestrator/')) return next()
    return jwtMiddleware(c, next)
  })

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

/** Pipe SSE Response xuống Node `res` theo chunk (không buffer arrayBuffer); resolve khi client đóng kết nối hoặc stream tự kết thúc. */
function streamSseResponse(
  req: IncomingMessage,
  res: ServerResponse,
  response: Response,
  headers: Headers,
): Promise<string | null> {
  return new Promise((resolve) => {
    res.statusCode = response.status
    headers.forEach((value, key) => res.setHeader(key, value))
    res.flushHeaders?.()

    const reader = response.body!.getReader()
    let closed = false
    let streamError: string | null = null
    const finish = () => {
      if (closed) return
      closed = true
      reader.cancel().catch(() => {})
      resolve(streamError)
    }
    req.on('close', finish)

    void (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done || res.writableEnded) break
          res.write(Buffer.from(value))
        }
      } catch (err) {
        // `closed` đã true ⇒ client tự đóng kết nối, không phải lỗi thật — không throw lên `handle()` (response đã bắt đầu stream).
        if (!closed) streamError = String(err instanceof Error ? err.message : err)
      } finally {
        if (!res.writableEnded) res.end()
        finish()
      }
    })()
  })
}

export function createApiHandler(ctx: RegistryContext) {
  // Lazy init, memoized; reset on failure so a transient error doesn't pin every later request to 500.
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
    // Request logging is fire-and-forget in `finally`, never awaited into the response.
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
        const contentType = headers.get('content-type') || ''
        if (contentType.startsWith('text/event-stream')) {
          // durationMs ở `finally` tính luôn thời gian sống của kết nối SSE — chấp nhận vì route stream không dùng số này việc khác.
          responsePreview = '[sse stream]'
          errored = await streamSseResponse(req, res, response, headers)
        } else {
          const buf = Buffer.from(await response.arrayBuffer())
          responsePreview = formatResponsePreview(buf, headers.get('content-type'))
          writeWebResponse(res, response.status, headers, buf)
        }
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
