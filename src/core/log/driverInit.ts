import { setLogDriver } from './driver.js'
import { getLogDriverPref } from './loggingPrefsIo.js'
import { sqliteLogDriver } from './sqliteDriver.js'

/**
 * Switch the active log driver to match `settings.json` (`logging.driver`).
 * Idempotent — safe to call on every `createApp()` (mirrors `installEventLogSubscriber`).
 * Default driver stays `file` when the pref is missing/invalid — no call needed for that case.
 */
export function initLogDriverFromPrefs(): void {
  if (getLogDriverPref() === 'sqlite') setLogDriver(sqliteLogDriver)
}
