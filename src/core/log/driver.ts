import type { LogEntry } from './schema.js'
import { appendFileLog } from './fileDriver.js'

/** Pluggable sink for request/audit JSONL entries. */
export type LogDriver = {
  append(entry: LogEntry): Promise<void>
}

const fileDriver: LogDriver = {
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

/** Khôi phục driver file mặc định (vd sau test). */
export function resetLogDriver(): void {
  activeDriver = fileDriver
}
