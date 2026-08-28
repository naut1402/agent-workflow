import { createToken, type ContainerToken } from '../../../core/container/index.js'
import type { NlChatBusiness } from './NlChatBusiness.js'

/** Surface hẹp cho controller + peer. FE-safe: xem ghi chú ở `agent-editor/business/tokens.ts`. */
export type NlChatPort = Pick<
  NlChatBusiness,
  | 'ensureBuilderAgent'
  | 'catalogAgentRefs'
  | 'startSession'
  | 'continueSession'
  | 'getTurn'
  | 'cancelSession'
  | 'isSessionId'
>

export const nlChatBusinessToken: ContainerToken<NlChatPort> =
  createToken<NlChatPort>('nlChatBusiness')
