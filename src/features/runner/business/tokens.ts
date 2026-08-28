import { createToken, type ContainerToken } from '../../../core/container/index.js'
import type { RunnerBusiness } from './RunnerBusiness.js'

/**
 * Surface hẹp cho controller + peer (`monitor`, `automations`, `logs`, `nl-chat`).
 * FE-safe: xem ghi chú ở `agent-editor/business/tokens.ts`.
 */
export type RunnerPort = Pick<
  RunnerBusiness,
  | 'listRunners'
  | 'upsertRunner'
  | 'deleteRunner'
  | 'setDefaultRunner'
  | 'listConnections'
  | 'scanLocalCommands'
  | 'upsertConnection'
  | 'deleteConnection'
  | 'listCustomCommands'
  | 'upsertCustomCommand'
  | 'deleteCustomCommand'
  | 'listCredentials'
  | 'upsertCredential'
  | 'deleteCredential'
  | 'loadJob'
  | 'listJobs'
  | 'submitJob'
  | 'cancelJob'
  | 'getApprovalDiff'
  | 'approveJob'
  | 'discardJob'
  | 'sendJobFeedback'
>

export const runnerBusinessToken: ContainerToken<RunnerPort> =
  createToken<RunnerPort>('runnerBusiness')
