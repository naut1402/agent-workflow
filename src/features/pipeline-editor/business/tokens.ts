import { createToken, type ContainerToken } from '../../../core/container/index.js'
import type { PipelineEditorBusiness } from './PipelineEditorBusiness.js'

/**
 * Surface hẹp cho controller + peer (`agent-editor`, `nl-chat`, `monitor`).
 * FE-safe: xem ghi chú ở `agent-editor/business/tokens.ts`.
 */
export type PipelineEditorPort = Pick<
  PipelineEditorBusiness,
  'getCatalog' | 'getRules' | 'profilesDir' | 'customAgentsDir'
>

export const pipelineEditorBusinessToken: ContainerToken<PipelineEditorPort> =
  createToken<PipelineEditorPort>('pipelineEditorBusiness')
