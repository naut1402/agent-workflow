export const common = {
  brand: 'Dev Team',
  sidebar: {
    expand: 'Expand sidebar',
    collapse: 'Collapse sidebar',
    connected: 'live',
    disconnected: 'disconnected',
    settings: 'Settings',
  },
  modes: {
    monitor: 'Monitor',
    pipelineEditor: 'Pipeline Editor',
    agentEditor: 'Agent Editor',
    quickAction: 'Quick Action',
    knowledge: 'Knowledge',
    runner: 'Runner',
    runnerConfig: 'Runner Config',
    logs: 'Logs',
  },
  status: {
    updated: 'updated {time}',
    paused: {
      editor: 'editor mode — polling paused',
      agentEditor: 'agent editor — polling paused',
      quickAction: 'quick action — polling paused',
      knowledge: 'knowledge — polling paused',
      runner: 'runner config — polling paused',
      logs: 'logs — polling paused',
    },
  },
  language: {
    title: 'Language',
    desc: 'Choose the display language of the interface.',
    vi: 'Tiếng Việt',
    en: 'English',
  },
  errors: {
    updateTaskStatus: 'Could not update task status (error {status})',
    archiveTask: 'Could not archive task (error {status})',
    saveCustomAgent: 'Could not save custom agent (server returned no name).',
  },
}
