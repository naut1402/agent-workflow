/** Helper dùng chung cho test route SSE (`tasksStream.route.test.ts`, `jobsStream.route.test.ts`). */
export async function readFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 500,
): Promise<string | null> {
  const decoder = new TextDecoder()
  const result = await Promise.race([
    reader.read().then((r) => (r.done ? null : decoder.decode(r.value))),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
  ])
  return result === 'timeout' ? null : (result as string | null)
}

export function parseFrame(frame: string): { type: string; data: any } {
  const m = /^event: (\w+)\ndata: (.+)\n\n$/.exec(frame)
  if (!m) throw new Error(`not a valid SSE frame: ${JSON.stringify(frame)}`)
  return { type: m[1], data: JSON.parse(m[2]) }
}
