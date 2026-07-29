import type { DashboardPlugin } from '@shared/host/contract'
import type { HostContext } from '../../shared/host/hostContext'
import PipelineEditor from './components/PipelineEditor.vue'
import { pipelineEditorApi } from './api'

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
    ctx.api.register('pipeline-editor', pipelineEditorApi)
  },
}
