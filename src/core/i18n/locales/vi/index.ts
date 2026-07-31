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

// Vietnamese is the default locale and the source of truth for the message
// schema (see `Messages`). Other locales are typed against it, so a missing key
// is a compile error, not a runtime fallback.
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
