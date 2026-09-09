import { AbstractBusiness } from '../../../core/business/AbstractBusiness.js'
import {
  listCustomAgentMeta,
  readCustomAgent,
  customAgentsDir,
  agentTemplatesDir,
  workflowStepTemplatesDir,
} from './index.js'

export class AgentEditorBusiness extends AbstractBusiness {
  async listMeta() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    return listCustomAgentMeta(gate.root)
  }

  async readAgent(name: string) {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    return readCustomAgent(gate.root, name)
  }

  agentsDir() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    return { root: gate.root, dir: customAgentsDir(gate.root) }
  }

  templatesDir() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    return { root: gate.root, dir: agentTemplatesDir(gate.root) }
  }

  workflowTemplatesDir() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    return { root: gate.root, dir: workflowStepTemplatesDir(gate.root) }
  }
}
