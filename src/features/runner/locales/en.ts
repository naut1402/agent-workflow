
// English translations for the `runner` namespace. Typed against the vi schema
// so any missing/extra key is a compile error.
export default {
  panel: {
    title: 'Runner Config',
    subtitle: 'Manage AI Agent Runners (global ~/.dev-team-dashboard/)',
    addRunner: '+ Add runner',
    empty: 'No runners yet. Click «+ Add runner» to create one.',
    makeDefault: 'Set as default',
    deleteRunner: 'Delete runner',
    recentJobs: 'Recent jobs',
  },
  toggle: {
    enable: 'Enable runner',
    disable: 'Disable runner',
  },
  status: {
    on: 'Enabled',
    off: 'Disabled',
  },
  fields: {
    name: 'Runner name',
    status: 'Status',
    connectionPlaceholder: 'Select connection…',
    allowedTools: 'Allowed tools',
    consoleHint:
      'Console command: plain argv (cliPath + flags + prompt args). No allowedTools / agent_ref / system prompt.',
  },
  actions: {
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    test: 'Test',
    testing: 'Testing…',
    refresh: 'Refresh',
  },
  dialog: {
    addTitle: 'Add runner',
    editTitle: 'Edit runner',
  },
  a11y: {
    close: 'Close',
  },
  messages: {
    saved: 'Saved {id}',
    enabled: 'Enabled {id}',
    disabled: 'Disabled {id}',
    deleted: 'Deleted',
    confirmDelete: 'Delete runner {id}?',
    connectionAdded: 'Added connection {id}',
  },
  errors: {
    nameRequired: 'Enter a runner name',
    connectionRequired: 'Select a connection',
    saveBeforeTest: 'Save the runner before testing',
    cliPathRequired: 'Enter a CLI path',
    connLabelRequired: 'Enter a connection name',
    commandRequired: 'Select a command or register a new one',
  },
  connectionDialog: {
    title: 'Add connection',
    labelField: 'Connection name',
    kind: 'Kind',
    kindGroup: 'Connection kind',
    scanning: 'Scanning…',
    register: 'Register…',
    commandPlaceholder: 'Select command…',
    notOnPath: ' (not on PATH)',
    custom: ' · custom',
    credentialPlaceholder: 'Select credential…',
    credLabelField: 'Name',
    saveCredential: 'Save credential',
    saveConnection: 'Save connection',
  },
  registerDialog: {
    title: 'Register command',
    commandField: 'Command name',
    commandPlaceholder: 'e.g. claude (optional)',
    pathPlaceholder: 'claude or full path',
    flagsField: 'Params / flags (optional)',
    addToList: 'Add to list',
  },
}
