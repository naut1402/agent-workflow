import { onUnmounted, ref, watch, type Ref } from 'vue'
import { fetchJobLog } from '../../features/logs/LogsPanelApi'

export interface JobLogStreamOptions {
  /** Long-poll wait hint passed to the server (ms). */
  waitMs?: number
  /** Pause polling without tearing down refs. */
  active?: Ref<boolean>
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled'])

export function isJobLogTerminal(status?: string): boolean {
  return Boolean(status && TERMINAL.has(status))
}

/**
 * Delta poll loop for `GET /api/jobs/:id/log?offset=&wait=`.
 * Keeps a byte cursor, handles log truncation (`reset`) and chunked tail (`hasMore`).
 */
export function useJobLogStream(jobId: Ref<string | null>, opts: JobLogStreamOptions = {}) {
  const text = ref('')
  const offset = ref(0)
  const status = ref<string | undefined>(undefined)
  const exitCode = ref<number | null | undefined>(undefined)
  const eof = ref(false)
  const error = ref<string | null>(null)
  const polling = ref(false)

  const waitMs = opts.waitMs ?? 3000
  let stopRequested = false

  function resetBuffer() {
    text.value = ''
    offset.value = 0
    status.value = undefined
    exitCode.value = undefined
    eof.value = false
    error.value = null
  }

  async function pollOnce(id: string): Promise<boolean> {
    const data = await fetchJobLog(id, { offset: offset.value, wait: waitMs })

    if (data.reset) {
      text.value = data.text || ''
      offset.value = typeof data.size === 'number' ? data.size : text.value.length
    } else if (data.text) {
      text.value += data.text
      offset.value = typeof data.size === 'number' ? data.size : offset.value + data.text.length
    } else if (typeof data.size === 'number') {
      offset.value = data.size
    }

    if (data.status != null) status.value = data.status
    if ('exitCode' in data) exitCode.value = data.exitCode ?? null
    if (data.eof != null) eof.value = Boolean(data.eof)
    else if (isJobLogTerminal(data.status)) eof.value = true

    // Legacy tail endpoint: no delta fields — treat first chunk as full tail.
    if (data.truncated && !data.text && offset.value === 0 && typeof data.size === 'number') {
      /* size-only heartbeat */
    }

    if (data.hasMore) return true
    if (isJobLogTerminal(data.status)) return false
    if (data.eof) return false
    return true
  }

  async function runLoop(id: string) {
    polling.value = true
    error.value = null
    try {
      while (!stopRequested) {
        if (opts.active && !opts.active.value) {
          await sleep(200)
          continue
        }
        let again: boolean
        try {
          again = await pollOnce(id)
        } catch (e: unknown) {
          error.value = String((e as Error)?.message ?? e)
          await sleep(waitMs)
          continue
        }
        if (!again) break
        if (!stopRequested && !(opts.active && !opts.active.value)) {
          // Immediate follow-up when the server capped the chunk.
          continue
        }
      }
    } finally {
      polling.value = false
    }
  }

  function start() {
    stop()
    const id = jobId.value
    if (!id) return
    stopRequested = false
    void runLoop(id)
  }

  function stop() {
    stopRequested = true
  }

  watch(
    jobId,
    (id, prev) => {
      if (id === prev) return
      stop()
      resetBuffer()
      if (id) start()
    },
    { immediate: true },
  )

  onUnmounted(() => stop())

  return { text, offset, status, exitCode, eof, error, polling, resetBuffer, start, stop }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
