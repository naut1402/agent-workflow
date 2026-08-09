
// English strings for the `logs` feature module. Typed against the vi schema —
// a missing key is a compile error.
export default {
  title: 'Logs',
  subtitle: 'Centralized logs (global ~/.dev-team-dashboard/logs/)',
  tabs: {
    audit: 'Audit',
    request: 'Request',
    events: 'Events',
    jobs: 'Jobs',
  },
  columns: {
    time: 'Time',
    level: 'Level',
    traceId: 'Trace',
    op: 'Operation',
    entity: 'Entity',
    identifier: 'Identifier',
    project: 'Project',
    method: 'Method',
    path: 'Path',
    query: 'Params',
    response: 'Response',
    status: 'Status',
    ms: 'ms',
    event: 'Event',
    payload: 'Payload',
  },
  filters: {
    q: 'Quick filter…',
    traceId: 'Trace id…',
    level: 'Log level',
    levelAll: 'All',
    clear: 'Clear',
    useTrace: 'Filter by this trace id',
    sortHint: 'Click to sort; Shift+click to add sort columns',
  },
  copy: {
    hint: 'Click to copy',
    done: 'Copied',
    fail: 'Copy failed',
  },
  empty: {
    log: 'No logs yet.',
    job: 'No jobs yet.',
    allDisabled: 'All log types are disabled — enable them in Settings › General › Logs.',
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
