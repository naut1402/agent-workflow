/**
 * SSE response builder dùng chung cho các route stream (`/api/tasks/stream`,
 * `/api/jobs/stream`). `subscribe` chạy ngay khi client mở kết nối — thường
 * push snapshot đầu tiên rồi đăng ký lắng nghe event bus — và trả về hàm
 * unsubscribe, gọi khi client đóng kết nối (`ReadableStream.cancel`).
 */
export type SseSend = (type: string, data: unknown) => void
export type SseSubscribe = (send: SseSend) => () => void

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
      // Phòng khi có reverse proxy sau này — không có deployment thật để verify hôm nay.
      'X-Accel-Buffering': 'no',
    },
  })
}
