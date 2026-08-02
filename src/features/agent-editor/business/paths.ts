import { joinPath } from '../../../core/lib/fileHelper.js'

// Dashboard-managed config directories under a data root.
export function profilesDir(root: string): string {
  return joinPath(root, 'pipeline-profiles')
}

export function customAgentsDir(root: string): string {
  return joinPath(root, 'custom-agents')
}

export function agentTemplatesDir(root: string): string {
  return joinPath(root, 'agent-templates')
}

export function workflowStepTemplatesDir(root: string): string {
  return joinPath(root, 'workflow-step-templates')
}
