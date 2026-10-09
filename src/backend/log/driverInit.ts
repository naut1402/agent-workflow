import { setLogDriver } from './driver.js'
import { getLogDriverPref } from './loggingPrefsIo.js'
import { sqliteLogDriver } from './sqliteDriver.js'

/**
 * Switch the active log driver to match `settings.json` (`logging.driver`); idempotent.
 * Missing/invalid pref keeps `file`.
 */
export function initLogDriverFromPrefs(): void {
  if (getLogDriverPref() === 'sqlite') setLogDriver(sqliteLogDriver)
}
