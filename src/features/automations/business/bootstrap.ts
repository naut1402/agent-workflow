/**
 * Composition root của automations: bơm runner thật vào port
 * `AutomationRunner.ts` rồi khởi động scheduler + event subscriber.
 *
 * Nạp từ `api.ts` (route của feature được auto-load lúc dựng server). Dưới
 * `bun test` không chạy — test tự điều khiển tick / bind stub runner.
 */

import { bindAutomationRunner } from './AutomationRunner.js'
import { startEventTriggers } from './eventTrigger.js'
import { runAutomation } from './runAction.js'
import { startAutomationScheduler } from './scheduler.js'

if (!process.env.BUN_TEST) {
  bindAutomationRunner(runAutomation)
  startAutomationScheduler()
  startEventTriggers()
}
