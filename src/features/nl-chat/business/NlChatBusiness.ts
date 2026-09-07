import { AbstractBusiness } from '../../../core/business/AbstractBusiness.js'
import {
  startNlChatSession,
  continueNlChatSession,
  getNlChatTurn,
  cancelNlChatSession,
  isNlChatSessionId,
  ensureNlChatBuilderAgent,
  scanCustomAgents,
  buildCatalog,
  loadScanPatternsConfig,
} from './index.js'

export class NlChatBusiness extends AbstractBusiness {
  async ensureBuilderAgent() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    await ensureNlChatBuilderAgent(gate.root)
    return { root: gate.root }
  }

  async catalogAgentRefs() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    const catalog = await buildCatalog(gate.root, {
      scanCustomAgents,
      scanPatterns: loadScanPatternsConfig(),
    })
    return (catalog.agents || [])
      .map((a: any) => a?.id)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
  }

  startSession(input: Parameters<typeof startNlChatSession>[0]) {
    return startNlChatSession(input)
  }

  continueSession(id: string, projectId: string, message: string) {
    return continueNlChatSession(id, projectId, message)
  }

  getTurn(id: string) {
    return getNlChatTurn(id)
  }

  cancelSession(id: string, projectId: string) {
    return cancelNlChatSession(id, projectId)
  }

  isSessionId(id: string) {
    return isNlChatSessionId(id)
  }
}

export {
  startNlChatSession,
  continueNlChatSession,
  getNlChatTurn,
  cancelNlChatSession,
  isNlChatSessionId,
}
