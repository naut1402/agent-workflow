/**
 * Schema message từ locale `vi` (nguồn chân lý type).
 * Import tĩnh — dùng cho `Messages` / vue-i18n module augmentation.
 * Runtime messages được ghép bởi `loadLocales.ts` (glob).
 */
import common from './locales/common/vi'
import monitor from '../../features/monitor/locales/vi'
import agentEditor from '../../features/agent-editor/locales/vi'
import knowledge from '../../features/knowledge/locales/vi'
import runner from '../../features/runner/locales/vi'
import logs from '../../features/logs/locales/vi'
import pipelineEditor from '../../features/pipeline-editor/locales/vi'
import quickAction from '../../features/quick-action/locales/vi'
import settings from '../../features/settings/locales/vi'
import notifications from '../../features/notifications/locales/vi'

import commonEn from './locales/common/en'
import monitorEn from '../../features/monitor/locales/en'
import agentEditorEn from '../../features/agent-editor/locales/en'
import knowledgeEn from '../../features/knowledge/locales/en'
import runnerEn from '../../features/runner/locales/en'
import logsEn from '../../features/logs/locales/en'
import pipelineEditorEn from '../../features/pipeline-editor/locales/en'
import quickActionEn from '../../features/quick-action/locales/en'
import settingsEn from '../../features/settings/locales/en'
import notificationsEn from '../../features/notifications/locales/en'

export const vi = {
  common,
  monitor,
  agentEditor,
  knowledge,
  runner,
  logs,
  pipelineEditor,
  quickAction,
  settings,
  notifications,
}

export type Messages = typeof vi

/** Kiểm tra en đủ key theo schema vi (typecheck). */
export const en: Messages = {
  common: commonEn,
  monitor: monitorEn,
  agentEditor: agentEditorEn,
  knowledge: knowledgeEn,
  runner: runnerEn,
  logs: logsEn,
  pipelineEditor: pipelineEditorEn,
  quickAction: quickActionEn,
  settings: settingsEn,
  notifications: notificationsEn,
}
