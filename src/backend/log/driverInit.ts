import type { LogDriverKind } from '../../shared/log/loggingPrefs.js'
import type { LogDriver } from './driver.js'
import { fileLogDriver } from './fileDriver.js'
import { getLogDriverPref } from './loggingPrefsIo.js'
import { sqliteLogDriver } from './sqliteDriver.js'

/**
 * Chỗ lắp ráp duy nhất biết hiện thực `LogDriver`: registry theo `LogDriverKind`
 * và driver đang active. Thêm driver = thêm một dòng ở đây + một giá trị trong `LOG_DRIVER_KINDS`.
 */
const LOG_DRIVERS: Record<LogDriverKind, LogDriver> = {
  file: fileLogDriver,
  sqlite: sqliteLogDriver,
}

const DEFAULT_KIND: LogDriverKind = 'file'

let activeDriver: LogDriver = LOG_DRIVERS[DEFAULT_KIND]

/** Đặt driver log (mặc định: file JSONL). */
export function setLogDriver(driver: LogDriver): void {
  activeDriver = driver
}

/** Driver đang active — mặc định file. */
export function getLogDriver(): LogDriver {
  return activeDriver
}

/** Khôi phục driver file mặc định (vd sau test). */
export function resetLogDriver(): void {
  activeDriver = LOG_DRIVERS[DEFAULT_KIND]
}

/**
 * Switch the active log driver to match `settings.json` (`logging.driver`).
 * Idempotent — safe to call on every `createApp()` (mirrors `installEventLogSubscriber`).
 * Default driver stays `file` when the pref is missing/invalid — no call needed for that case.
 */
export function initLogDriverFromPrefs(): void {
  const kind = getLogDriverPref()
  if (kind !== DEFAULT_KIND) setLogDriver(LOG_DRIVERS[kind])
}
