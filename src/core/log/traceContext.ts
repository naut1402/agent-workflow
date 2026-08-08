import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

type TraceStore = { traceId: string }

const als = new AsyncLocalStorage<TraceStore>()

/** Current request/audit correlation id, if any. */
export function getTraceId(): string | null {
  return als.getStore()?.traceId ?? null
}

/** Run `fn` with `traceId` bound for nested emitAudit / appendRequestLog. */
export function runWithTraceId<T>(traceId: string, fn: () => T): T {
  return als.run({ traceId }, fn)
}

export async function runWithTraceIdAsync<T>(traceId: string, fn: () => Promise<T>): Promise<T> {
  return als.run({ traceId }, fn)
}

/** Prefer inbound `X-Trace-Id` / `X-Request-Id`, else mint a UUID. */
const SAFE_TRACE_ID = /^[A-Za-z0-9._:\-]{1,128}$/

export function resolveTraceIdFromRequest(req: IncomingMessage): string {
  const raw = req.headers['x-trace-id'] ?? req.headers['x-request-id']
  const v = Array.isArray(raw) ? raw[0] : raw
  if (typeof v === 'string') {
    const trimmed = v.trim().slice(0, 128)
    if (SAFE_TRACE_ID.test(trimmed)) return trimmed
  }
  return randomUUID()
}

export function newTraceId(): string {
  return randomUUID()
}
