export * from './brief.js'
export * from './decision.js'
export * from './decisionLoop.js'
export * from './orchestratorTokens.js'
export * from '../schemas/orchestrator.js'

import { startOrchestratorLoop } from './decisionLoop.js'

if (!process.env.BUN_TEST) {
  startOrchestratorLoop()
}
