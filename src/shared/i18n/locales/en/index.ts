import type { Messages } from '../vi'
import { common } from './common'
import { monitor } from './monitor'
import { agentEditor } from './agentEditor'
import { knowledge } from './knowledge'
import { runner } from './runner'
import { logs } from './logs'
import { pipelineEditor } from './pipelineEditor'
import { quickAction } from './quickAction'
import { settings } from './settings'
import { notifications } from './notifications'

// Typed against `Messages` (the vi schema) → any key present in vi but missing
// here is a compile error.
export const en: Messages = {
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
