import type { ModeRegistry, ShellContext } from '../../core/shell/modeRegistry'
import MonitorLayout from './components/MonitorLayout.vue'

/** Mode mặc định của app — statusKind 'live' (khác 8 mode còn lại đều 'paused'). */
export function registerMonitorMode(registry: ModeRegistry): void {
  registry.registerMode({
    key: 'monitor',
    labelKey: 'common.modes.monitor',
    icon: 'monitor',
    order: 1,
    statusKind: 'live',
    panel: MonitorLayout,
    bindings: (ctx: ShellContext) => {
      const c = ctx as Record<string, unknown>
      return {
        projects: c.projects,
        defaultProjectId: c.defaultProjectId,
        selectedProjectId: c.selectedProjectId,
        tasks: c.tasks,
        selectedId: c.selectedId,
        selected: c.selected,
        openArtifact: c.openArtifact,
        connected: c.connected,
        error: c.error,
        lastUpdated: c.lastUpdated,
        onSelectProject: c.onSelectProject,
        onProjectsChanged: c.onProjectsChanged,
        onSelectTask: c.onSelectTask,
        onOpenArtifact: c.onOpenArtifact,
        onQaSaved: c.poll,
        onHitlAction: c.poll,
        onTaskArchived: c.poll,
        onTaskDeleted: c.onTaskDeleted,
        onCreateTask: c.onCreateTaskOpen,
      }
    },
  })
}
