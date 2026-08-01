// English translations — typed against the vi schema via `en: Messages` in the
// en locale index, so a missing key here is a compile error.
export default {
  toolbar: {
    fanOutWarning:
      'Orchestrator runs sequentially — parallel branches are ordered topologically on save',
  },
  scope: {
    selectTask: '— Select task —',
    manualEntry: 'Enter manually…',
    taskIdPlaceholder: 'Task ID',
  },
  leftPanel: {
    expandTitle: 'Open catalog & rules',
    collapseTitle: 'Collapse catalog',
    catalogOpenTitle: 'Catalog — open panel',
    rulesOpenTitle: 'Rules — open panel',
  },
  preview: {
    waitingHitl: '— waiting for HITL',
    status: {
      pending: '⏳ Waiting',
      active: '▶ Running',
      done: '✓ Done',
      hitl: '⏸ HITL',
    },
  },
  rules: {
    noStepUsing: '— not used by any step',
  },
}
