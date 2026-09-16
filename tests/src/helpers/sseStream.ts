/**
 * Fake SSE byte stream cho test frontend (`openSseStream` đọc qua
 * `res.body!.getReader()`). `push()` enqueue một frame `event:`/`data:` theo
 * đúng format `sseHelper.ts` phát ra; `close()`/`error()` tuỳ chọn để mô phỏng
 * kết thúc bất thường (kích hoạt reconnect-with-backoff của `sseClient.ts`).
 */
export interface FakeSseStream {
  stream: ReadableStream<Uint8Array>
  push(type: string, data: unknown): void
  /** Enqueue raw text as-is (không tự thêm `\n\n`) — dùng để mô phỏng 1 frame bị cắt giữa 2 chunk. */
  pushRaw(text: string): void
  close(): void
  error(err: unknown): void
}

export function makeSseStream(): FakeSseStream {
  const encoder = new TextEncoder()
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
    },
  })
  return {
    stream,
    push(type: string, data: unknown) {
      controllerRef!.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`))
    },
    pushRaw(text: string) {
      controllerRef!.enqueue(encoder.encode(text))
    },
    close() {
      controllerRef!.close()
    },
    error(err: unknown) {
      controllerRef!.error(err)
    },
  }
}
