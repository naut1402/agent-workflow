import path from 'node:path'

// Dashboard-managed config directories under a data root.
export function profilesDir(root: string): string {
  return path.join(root, 'pipeline-profiles')
}

export function customAgentsDir(root: string): string {
  return path.join(root, 'custom-agents')
}

export function agentTemplatesDir(root: string): string {
  return path.join(root, 'agent-templates')
}

export function workflowStepTemplatesDir(root: string): string {
  return path.join(root, 'workflow-step-templates')
}
