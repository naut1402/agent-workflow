import { createToken, type ContainerToken } from '../../../core/container/index.js'
import type { KnowledgeBusiness } from './index.js'

/** Surface hẹp cho controller + peer. FE-safe: xem ghi chú ở `agent-editor/business/tokens.ts`. */
export type KnowledgePort = Pick<KnowledgeBusiness, 'getDriver' | 'loadConfig'>

export const knowledgeBusinessToken: ContainerToken<KnowledgePort> =
  createToken<KnowledgePort>('knowledgeBusiness')
