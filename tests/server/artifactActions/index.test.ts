import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  matchPattern,
  matchActions,
  findAction,
  artifactBase,
  substitutePrompt,
  toActionView,
  loadArtifactActions,
  DEFAULT_ARTIFACT_ACTIONS,
} from '../../../server/artifactActions/index.js'
import type { ArtifactAction } from '../../../shared/schemas/artifactAction.js'

const action = (over: Partial<ArtifactAction> = {}): ArtifactAction => ({
  id: 'improve-doc',
  label: '✨ Cải thiện tài liệu',
  artifact_patterns: ['investigate.md', 'design.md'],
  agent_ref: 'dev-agent-teams:doc-reviewer',
  prompt_template: 'Đọc {{artifact_name}}, ghi {{artifact_base}}-improved.md',
  produces: [],
  confirm: true,
  ...over,
})

describe('matchPattern', () => {
  test('exact filename match', () => {
    expect(matchPattern('design.md', 'design.md')).toBe(true)
    expect(matchPattern('design.md', 'investigate.md')).toBe(false)
  })
  test('glob * matches within a filename but not across separators', () => {
    expect(matchPattern('*.md', 'design.md')).toBe(true)
    expect(matchPattern('*.md', 'notes.txt')).toBe(false)
    expect(matchPattern('*.md', 'sub/design.md')).toBe(false)
    expect(matchPattern('design.*', 'design.md')).toBe(true)
  })
  test('empty inputs never match', () => {
    expect(matchPattern('', 'design.md')).toBe(false)
    expect(matchPattern('design.md', '')).toBe(false)
  })
})

describe('matchActions', () => {
  test('filters actions whose patterns match the artifact', () => {
    const all = [action(), action({ id: 'other', artifact_patterns: ['review.md'] })]
    expect(matchActions(all, 'design.md').map((a) => a.id)).toEqual(['improve-doc'])
    expect(matchActions(all, 'review.md').map((a) => a.id)).toEqual(['other'])
    expect(matchActions(all, 'qa.md')).toEqual([])
  })
})

describe('findAction / artifactBase / substitutePrompt / toActionView', () => {
  test('findAction returns match or null', () => {
    const all = [action()]
    expect(findAction(all, 'improve-doc')?.id).toBe('improve-doc')
    expect(findAction(all, 'nope')).toBeNull()
  })
  test('artifactBase strips the final extension', () => {
    expect(artifactBase('design.md')).toBe('design')
    expect(artifactBase('a.b.md')).toBe('a.b')
    expect(artifactBase('noext')).toBe('noext')
  })
  test('substitutePrompt replaces both placeholders (incl. whitespace variants)', () => {
    const out = substitutePrompt('Đọc {{artifact_name}} → {{ artifact_base }}-improved.md', {
      artifact_name: 'design.md',
      artifact_base: 'design',
    })
    expect(out).toBe('Đọc design.md → design-improved.md')
  })
  test('toActionView drops the template and patterns', () => {
    expect(toActionView(action())).toEqual({
      id: 'improve-doc',
      label: '✨ Cải thiện tài liệu',
      agent_ref: 'dev-agent-teams:doc-reviewer',
      confirm: true,
    })
  })
})

describe('loadArtifactActions', () => {
  let root: string
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-root-'))
  })
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

  test('falls back to the built-in default when the file is missing', async () => {
    const loaded = await loadArtifactActions(root)
    expect(loaded).toEqual(DEFAULT_ARTIFACT_ACTIONS)
    expect(loaded[0].id).toBe('improve-doc')
  })
  test('parses a valid YAML and applies defaults (overriding the built-in)', async () => {
    fs.writeFileSync(
      path.join(root, 'artifact-actions.yaml'),
      [
        'version: 1',
        'actions:',
        '  - id: improve-doc',
        '    label: "✨ Cải thiện tài liệu"',
        '    artifact_patterns: ["investigate.md", "design.md"]',
        '    agent_ref: dev-agent-teams:doc-reviewer',
        '    prompt_template: "Đọc {{artifact_name}}"',
      ].join('\n'),
    )
    const loaded = await loadArtifactActions(root)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe('improve-doc')
    expect(loaded[0].produces).toEqual([])
    expect(loaded[0].confirm).toBe(false)
  })
  test('falls back to the built-in default on schema mismatch (missing required field)', async () => {
    fs.writeFileSync(
      path.join(root, 'artifact-actions.yaml'),
      'version: 1\nactions:\n  - id: broken\n',
    )
    expect(await loadArtifactActions(root)).toEqual(DEFAULT_ARTIFACT_ACTIONS)
  })
})
