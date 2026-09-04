import type { ModeRegistry, ShellContext } from '../../core/shell/modeRegistry'
import { subSidebarBindings } from '../../core/shell/subSidebarBindings'
import PipelineEditor from './components/PipelineEditor.vue'

export function registerMode(registry: ModeRegistry): void {
  registry.registerMode({
    key: 'editor',
    labelKey: 'common.modes.pipelineEditor',
    icon: 'pipeline',
    order: 2,
    statusKind: 'paused',
    panel: PipelineEditor,
    // Không `persistKey` — panel trái của editor không nhớ trạng thái qua reload (giữ hành vi cũ).
    subSidebar: {},
    bindings: (ctx: ShellContext) => {
      const c = ctx as Record<string, unknown>
      return {
        scope: c.editorScope,
        taskId: c.editorTaskId,
        tasks: c.tasks,
        projectId: c.selectedProjectId,
        appSidebarCollapsed: c.sidebarCollapsed,
        'onUpdate:scope': c.onUpdateScope,
        'onUpdate:taskId': c.onUpdateTaskId,
        ...subSidebarBindings(ctx, 'editor'),
      }
    },
  })
}
