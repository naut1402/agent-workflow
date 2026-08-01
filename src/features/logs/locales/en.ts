
// English strings for the `logs` feature module. Typed against the vi schema —
// a missing key is a compile error.
export default {
  title: 'Logs',
  subtitle: 'Centralized logs (global ~/.dev-team-dashboard/logs/)',
  tabs: {
    audit: 'Audit',
    request: 'Request',
    jobs: 'Jobs',
  },
  columns: {
    time: 'Time',
    op: 'Operation',
    entity: 'Entity',
    identifier: 'Identifier',
    project: 'Project',
    method: 'Method',
    path: 'Path',
    status: 'Status',
    ms: 'ms',
  },
  empty: {
    log: 'No logs yet.',
    job: 'No jobs yet.',
  },
  jobs: {
    tailStart: '▶ Tail',
    tailStop: '⏹ Stop tail',
    truncated: '(head truncated)',
    logEmpty: '(empty log)',
    selectPrompt: 'Select a job to view its log.',
  },
  timeline: {
    heading: 'Activity timeline',
    empty: 'No activity yet.',
    now: 'now',
    artifactDetail: 'created artifact',
    phaseDetail: 'running',
    hitlDetail: 'awaiting approval',
  },
}
