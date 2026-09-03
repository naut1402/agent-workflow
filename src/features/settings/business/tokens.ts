import { createToken, type ContainerToken } from '../../../core/container/index.js'
import type { SettingsBusiness } from './index.js'

/**
 * Surface hẹp cho controller + peer (`monitor`, `runner`).
 * FE-safe: xem ghi chú ở `agent-editor/business/tokens.ts`.
 */
export type SettingsPort = Pick<
  SettingsBusiness,
  | 'getAutoscanConfig'
  | 'saveAutoscanConfig'
  | 'runAutoscan'
  | 'getGithubTokensConfig'
  | 'saveGithubTokensConfig'
  | 'getLoggingConfig'
  | 'saveLoggingConfig'
  | 'getRecoverySettings'
  | 'saveRecoverySettings'
  | 'browseDirectory'
>

export const settingsBusinessToken: ContainerToken<SettingsPort> =
  createToken<SettingsPort>('settingsBusiness')
