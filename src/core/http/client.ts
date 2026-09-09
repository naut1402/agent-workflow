import { getApiToken } from '../lib/authToken.js'

/**
 * FE HTTP client helpers (browser). Không import từ Node/server setup.
 * Server Hono dùng AbstractController / respond / types cùng thư mục này.
 */

/** Query string helper — bỏ null/undefined/'' và encode value (`?project=`). */
export function qs(params: Record<string, any> | null | undefined): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined || v === '') continue
    parts.push(`${k}=${encodeURIComponent(v)}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

/** Fetch có token khi cấu hình; không token → fetch thường. */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = getApiToken()
  if (!token) return fetch(input, init)

  const headers = new Headers(init.headers || {})
  if (!headers.has('Authorization') && !headers.has('X-Dev-Team-Token')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(input, { ...init, headers })
}

export type ApiQuery = Record<string, any> | null | undefined

export interface ApiRequestOptions {
  query?: ApiQuery
  body?: unknown
  /** Override method (mặc định theo wrapper). */
  method?: string
  headers?: HeadersInit
  /** Bỏ qua JSON body (vd FormData). */
  rawBody?: BodyInit | null
  /** Không gắn Content-Type: application/json. */
  skipJsonContentType?: boolean
  /** Prefill error message khi !ok và body không có `error`. */
  errorMessage?: string | ((status: number, data: any) => string)
  /** Gắn thêm field lên Error (status/data/body). */
  attach?: 'data' | 'body' | 'none'
}

function buildUrl(path: string, query?: ApiQuery): string {
  return `${path}${qs(query)}`
}

function logApi(level: 'warn' | 'error', message: string, detail?: unknown) {
  const line = `[api] ${message}`
  if (detail !== undefined) console[level](line, detail)
  else console[level](line)
}

function makeError(
  message: string,
  status: number,
  data: unknown,
  attach: ApiRequestOptions['attach'] = 'data',
): Error {
  const err = new Error(message)
  ;(err as any).status = status
  if (attach === 'data') (err as any).data = data
  if (attach === 'body') (err as any).body = data
  return err
}

/**
 * JSON request dùng chung: parse body, map !ok → Error, log lỗi.
 * PUT/DELETE/PATCH gọi qua đây; GET/POST ưu tiên `apiGet` / `apiPost`.
 */
export async function apiRequest<T = any>(
  method: string,
  path: string,
  opts: ApiRequestOptions = {},
): Promise<T> {
  const url = buildUrl(path, opts.query)
  const upper = method.toUpperCase()
  const headers = new Headers(opts.headers || {})
  let body: BodyInit | undefined | null = opts.rawBody

  if (body === undefined && opts.body !== undefined) {
    if (!opts.skipJsonContentType && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    body = JSON.stringify(opts.body)
  }

  try {
    const r = await apiFetch(url, { method: upper, headers, body: body ?? undefined })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      const fallback =
        typeof opts.errorMessage === 'function'
          ? opts.errorMessage(r.status, data)
          : opts.errorMessage || `${upper} ${path} → ${r.status}`
      const message = (data && (data as any).error) || fallback
      logApi('error', `${upper} ${url} → ${r.status}`, data)
      throw makeError(String(message), r.status, data, opts.attach ?? 'data')
    }
    return data as T
  } catch (err) {
    if ((err as any)?.status != null) throw err
    logApi('error', `${upper} ${url} failed`, err)
    throw err
  }
}

/** GET JSON — query optional. */
export async function apiGet<T = any>(
  path: string,
  query?: ApiQuery,
  opts: Omit<ApiRequestOptions, 'query' | 'body' | 'rawBody' | 'method'> = {},
): Promise<T> {
  return apiRequest<T>('GET', path, { ...opts, query })
}

/** POST JSON — `body` optional; truyền `opts.method` nếu cần biến thể hiếm. */
export async function apiPost<T = any>(
  path: string,
  body?: unknown,
  opts: Omit<ApiRequestOptions, 'body'> & { query?: ApiQuery } = {},
): Promise<T> {
  return apiRequest<T>(opts.method || 'POST', path, { ...opts, body })
}
