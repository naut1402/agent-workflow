import { describe, expect, test } from 'bun:test'
import { checkDevTeamArtifacts } from '../../../scripts/check-devteam-artifacts.js'

describe('checkDevTeamArtifacts', () => {
  test('ok when only skeleton files tracked', () => {
    const result = checkDevTeamArtifacts({
      listTrackedFiles: () => [
        '.dev-team-agent/.dev-state/.gitkeep',
        '.dev-team-agent/tasks/.gitkeep',
        '.dev-team-agent/README.md',
      ],
    })
    expect(result.ok).toBe(true)
  })

  test('ok when nothing tracked', () => {
    const result = checkDevTeamArtifacts({ listTrackedFiles: () => [] })
    expect(result.ok).toBe(true)
  })

  test('fails when a real artifact file is tracked', () => {
    const result = checkDevTeamArtifacts({
      listTrackedFiles: () => [
        '.dev-team-agent/.dev-state/.gitkeep',
        '.dev-team-agent/tasks/U0001/design.md',
      ],
    })
    expect(result.ok).toBe(false)
    if ('unexpected' in result) expect(result.unexpected).toEqual(['.dev-team-agent/tasks/U0001/design.md'])
  })
})
