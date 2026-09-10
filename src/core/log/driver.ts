import type { LogEntry } from './schema.js'
import { appendFileLog } from './fileDriver.js'

/** Pluggable sink for request/audit JSONL entries. */
export type LogDriver = {
  /** Which storage backend this is — lets readers (`readLogs`) pick a matching query path. */
  kind?: 'file' | 'sqlite'
  append(entry: LogEntry): Promise<void>
}

const fileDriver: LogDriver = {
  kind: 'file',
  append: appendFileLog,
}

let activeDriver: LogDriver = fileDriver

/** Đặt driver ghi log (mặc định: file JSONL). */
export function setLogDriver(driver: LogDriver): void {
  activeDriver = driver
}

/** Driver đang active — mặc định file. */
export function getLogDriver(): LogDriver {
  return activeDriver
}

/** Kind của driver đang active — mặc định `'file'`. */
export function activeLogDriverKind(): 'file' | 'sqlite' {
  return activeDriver.kind ?? 'file'
}

/** Khôi phục driver file mặc định (vd sau test). */
export function resetLogDriver(): void {
  activeDriver = fileDriver
}
