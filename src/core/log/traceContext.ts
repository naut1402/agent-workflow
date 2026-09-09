import * as asyncHooks from 'node:async_hooks'
import { randomUUID } from '../lib/fileHelper.js'
import type { IncomingMessage } from 'node:http'

type TraceStore = { traceId: string }

// Lazy ALS — named `from 'node:async_hooks'` / eager `new AsyncLocalStorage` is
// rewritten by Vite to property access at module init and throws if this file
// ever lands in the client graph.
let als: asyncHooks.AsyncLocalStorage<TraceStore> | undefined
function traceAls(): asyncHooks.AsyncLocalStorage<TraceStore> {
  if (!als) als = new asyncHooks.AsyncLocalStorage<TraceStore>()
  return als
}

/** Current request/audit correlation id, if any. */
export function getTraceId(): string | null {
  return traceAls().getStore()?.traceId ?? null
}

/** Run `fn` with `traceId` bound for nested emitAudit / appendRequestLog. */
export function runWithTraceId<T>(traceId: string, fn: () => T): T {
  return traceAls().run({ traceId }, fn)
}

export async function runWithTraceIdAsync<T>(traceId: string, fn: () => Promise<T>): Promise<T> {
  return traceAls().run({ traceId }, fn)
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
