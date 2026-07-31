import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { agentTemplatesDir, customAgentsDir, profilesDir, workflowStepTemplatesDir } from '../../../../src/features/agent-editor/business/paths'

const root = path.resolve('/data/.dev-team-agent')

describe('config path helpers', () => {
  test('map to the right subdirectories of the root', () => {
    expect(profilesDir(root)).toBe(path.join(root, 'pipeline-profiles'))
    expect(customAgentsDir(root)).toBe(path.join(root, 'custom-agents'))
    expect(agentTemplatesDir(root)).toBe(path.join(root, 'agent-templates'))
    expect(workflowStepTemplatesDir(root)).toBe(path.join(root, 'workflow-step-templates'))
  })
})
