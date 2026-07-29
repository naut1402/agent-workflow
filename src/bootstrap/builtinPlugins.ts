import type { DashboardPlugin } from '@shared/host/contract'
import type { HostContext } from '../shared/host/hostContext'
import { monitorPlugin } from '../features/monitor/host.plugin'
import { pipelineEditorPlugin } from '../features/pipeline-editor/host.plugin'
import { agentEditorPlugin } from '../features/agent-editor/host.plugin'
import { quickActionPlugin } from '../features/quick-action/host.plugin'
import { knowledgePlugin } from '../features/knowledge/host.plugin'
import { runnerPlugin } from '../features/runner/host.plugin'
import { logsPlugin } from '../features/logs/host.plugin'
import { notificationsPlugin } from '../features/notifications/host.plugin'

/**
 * Static boot-time registration list (issue #159 Việc 1) — the code-level
 * counterpart of the module ↔ seam inventory table in investigate.md §4.2.
 * Order here drives sidebar order in `App.vue`.
 */
export const BUILTIN_PLUGINS: DashboardPlugin<HostContext>[] = [
  monitorPlugin,
  pipelineEditorPlugin,
  agentEditorPlugin,
  quickActionPlugin,
  knowledgePlugin,
  runnerPlugin,
  logsPlugin,
  notificationsPlugin,
]
