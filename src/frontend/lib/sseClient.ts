import { apiFetch, qs, type ApiQuery } from '../http/client'

/**
 * Fetch-based SSE reader — không dùng `EventSource` gốc vì nó không set được
 * header `Authorization`, cần cho JWT khi `DASHBOARD_JWT_SECRET` bật.
 * `apiFetch()` đã tự gắn header đó, reader chỉ việc tái dùng.
 */
export interface SseStreamHandlers {
  onEvent: (type: string, data: unknown) => void
  onOpen?: () => void
  onError?: (err: unknown) => void
}

export interface SseStream {
  close(): void
}

const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Tách 1 khối SSE (`event:`/`data:` phân cách `\n`) thành `[type, data]`. */
function parseSseBlock(block: string): [string, string] | null {
  let type = ''
  let data = ''
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) type = line.slice('event:'.length).trim()
    else if (line.startsWith('data:')) data = line.slice('data:'.length).trim()
  }
  if (!type || !data) return null
  return [type, data]
}

export function openSseStream(path: string, query: ApiQuery, handlers: SseStreamHandlers): SseStream {
  const { onEvent, onOpen, onError } = handlers
  let stopped = false
  const aborter = new AbortController()
  let backoffMs = INITIAL_BACKOFF_MS

  async function loop(): Promise<void> {
    try {
      const res = await apiFetch(`${path}${qs(query)}`, {
        signal: aborter.signal,
        headers: { Accept: 'text/event-stream' },
      })
      if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
      onOpen?.()
      backoffMs = INITIAL_BACKOFF_MS
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (!stopped) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const blocks = buf.split('\n\n')
        buf = blocks.pop() ?? ''
        for (const block of blocks) {
          const parsed = parseSseBlock(block)
          if (!parsed) continue
          const [type, data] = parsed
          onEvent(type, JSON.parse(data))
        }
      }
    } catch (err) {
      if (aborter.signal.aborted) return
      onError?.(err)
    }
    if (!stopped) {
      await delay(backoffMs)
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS)
      void loop()
    }
  }

  void loop()

  return {
    close() {
      stopped = true
      aborter.abort()
    },
  }
}
