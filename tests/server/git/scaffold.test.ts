import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureDevTeamWorkspace, scaffoldDevTeamWorkspace } from '../../../server/git/scaffold'

describe('scaffoldDevTeamWorkspace', () => {
  test('creates .dev-state and tasks under project root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-'))
    const ws = scaffoldDevTeamWorkspace(root)
    expect(ws).toBe(path.join(root, '.dev-team-agent'))
    expect(fs.existsSync(path.join(ws, '.dev-state'))).toBe(true)
    expect(fs.existsSync(path.join(ws, 'tasks'))).toBe(true)
  })

  test('ensureDevTeamWorkspace is idempotent when workspace exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-'))
    const first = scaffoldDevTeamWorkspace(root)
    fs.writeFileSync(path.join(first, '.dev-state', 'A.json'), '{}')
    const second = ensureDevTeamWorkspace(root)
    expect(second).toBe(first)
    expect(fs.readFileSync(path.join(first, '.dev-state', 'A.json'), 'utf8')).toBe('{}')
  })
})
