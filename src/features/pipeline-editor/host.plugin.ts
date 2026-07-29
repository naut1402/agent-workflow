import type { DashboardPlugin } from '@shared/host/contract'
import type { HostContext } from '../../shared/host/hostContext'
import PipelineEditor from './components/PipelineEditor.vue'

/** Thin registration wrapper — no change to `PipelineEditor.vue` itself. */
export const pipelineEditorPlugin: DashboardPlugin<HostContext> = {
  id: 'pipeline-editor',
  activate(ctx) {
    ctx.registerMode({
      id: 'editor',
      labelKey: 'common.modes.pipelineEditor',
      icon: 'pipeline',
      entry: PipelineEditor,
      pausedStatusKey: 'common.status.paused.editor',
    })
  },
}
