const locks = new Map<string, Promise<unknown>>()

/** In-process mutex per project id — concurrent sync requests queue. */
export async function withProjectSyncLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const chained = prev.then(() => gate)
  locks.set(id, chained)
  await prev
  try {
    return await fn()
  } finally {
    release()
    if (locks.get(id) === chained) locks.delete(id)
  }
}
