// Public API surface for the frontend: fetch client (split by domain under
// `resources/`, see design.md E0004-02 §3.1) + pure phase derivation.
export * from './resources/workspace'
export * from './resources/tasks'
export * from './resources/jobs'
export * from './resources/pipeline'
export * from './resources/catalog'
export * from './resources/artifacts'
export * from './resources/agents'
export * from './resources/knowledge'
export * from './resources/runners'
export * from './resources/logs'
export * from './phase'
