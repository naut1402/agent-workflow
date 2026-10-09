export type SseSend = (type: string, data: unknown) => void
export type SseSubscribe = (send: SseSend) => () => void

/** SSE response cho route stream: `subscribe` chạy khi client mở kết nối, hàm nó trả về chạy khi client đóng. */
export function sseResponse(subscribe: SseSubscribe): Response {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send: SseSend = (type, data) => {
        if (closed) return
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      unsubscribe = subscribe(send)
    },
    cancel() {
      closed = true
      unsubscribe?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
