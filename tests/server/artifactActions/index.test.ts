import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  matchPattern,
  matchActions,
  matchByAttach,
  findAction,
  artifactBase,
  substitutePrompt,
  toActionView,
  normalizeAction,
  loadArtifactActions,
  loadArtifactActionsFile,
  saveArtifactActions,
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
  attach_points: ['artifact-title'],
  ...over,
})

describe('DEFAULT_ARTIFACT_ACTIONS', () => {
  test('improve-doc has no agent_ref — prompt_template is free-form, incompatible with a rigid pipeline agent', () => {
    // Regression guard: this used to be 'dev-agent-teams:doc-reviewer', whose
    // own instructions forbid editing the file it reviews and expect
    // `$ARGUMENTS = <task-id> --doc=...` — contradicting this action's own
    // "rewrite the file in place" prompt_template, which confused the runner
    // into asking for clarification instead of doing the edit.
    const improveDoc = DEFAULT_ARTIFACT_ACTIONS.find((a) => a.id === 'improve-doc')
    expect(improveDoc?.agent_ref).toBe('')
  })

  test('improve-doc runs the approval flow from both the title and selection toolbars', () => {
    const improveDoc = DEFAULT_ARTIFACT_ACTIONS.find((a) => a.id === 'improve-doc')
    expect(improveDoc?.require_approval).toBe(true)
    expect(improveDoc?.attach_points).toEqual(['artifact-title', 'artifact-selection'])
    // The agent RESPONDS with the improved content (stdout), which the server
    // captures as the proposed edit and splices into the selected range. The
    // template exposes both the selection and the artifact name so it works from
    // the selection toolbar ({{selection}}) and the title toolbar ({{artifact_name}}).
    expect(improveDoc?.prompt_template).toContain('{{selection}}')
    expect(improveDoc?.prompt_template).toContain('{{artifact_name}}')
  })
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

describe('matchByAttach', () => {
  test('filters by pattern AND attach point', () => {
    const all = [
      action({ id: 'title-only', attach_points: ['artifact-title'] }),
      action({ id: 'selection-only', attach_points: ['artifact-selection'] }),
      action({ id: 'both', attach_points: ['artifact-title', 'artifact-selection'] }),
    ]
    expect(matchByAttach(all, 'design.md', 'artifact-title').map((a) => a.id)).toEqual([
      'title-only',
      'both',
    ])
    expect(matchByAttach(all, 'design.md', 'artifact-selection').map((a) => a.id)).toEqual([
      'selection-only',
      'both',
    ])
  })
  test('treats a missing attach_points as title-only', () => {
    const all = [action({ id: 'legacy', attach_points: undefined as unknown as string[] })]
    expect(matchByAttach(all, 'design.md', 'artifact-title').map((a) => a.id)).toEqual(['legacy'])
    expect(matchByAttach(all, 'design.md', 'artifact-selection')).toEqual([])
  })
})

describe('normalizeAction', () => {
  test('defaults a missing/empty attach_points to title-only', () => {
    expect(normalizeAction(action({ attach_points: undefined as unknown as string[] })).attach_points).toEqual([
      'artifact-title',
    ])
    expect(normalizeAction(action({ attach_points: [] })).attach_points).toEqual(['artifact-title'])
  })
  test('leaves an existing attach_points untouched', () => {
    expect(normalizeAction(action({ attach_points: ['artifact-selection'] })).attach_points).toEqual([
      'artifact-selection',
    ])
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
  test('substitutePrompt replaces {{selection}} (defaulting to empty when absent)', () => {
    const withSelection = substitutePrompt('Cải thiện: {{ selection }}', {
      artifact_name: 'design.md',
      artifact_base: 'design',
      selection: 'đoạn văn bôi đen',
    })
    expect(withSelection).toBe('Cải thiện: đoạn văn bôi đen')
    const withoutSelection = substitutePrompt('Cải thiện: {{selection}}', {
      artifact_name: 'design.md',
      artifact_base: 'design',
    })
    expect(withoutSelection).toBe('Cải thiện: ')
  })
  test('substitutePrompt replaces {{selection_lines}} (range, single line, or empty)', () => {
    const range = substitutePrompt('Sửa dòng {{selection_lines}}', {
      artifact_name: 'design.md',
      artifact_base: 'design',
      selectionStartLine: 12,
      selectionEndLine: 15,
    })
    expect(range).toBe('Sửa dòng 12-15')

    const singleLine = substitutePrompt('Sửa dòng {{ selection_lines }}', {
      artifact_name: 'design.md',
      artifact_base: 'design',
      selectionStartLine: 12,
      selectionEndLine: 12,
    })
    expect(singleLine).toBe('Sửa dòng 12')

    const absent = substitutePrompt('Sửa dòng {{selection_lines}}', {
      artifact_name: 'design.md',
      artifact_base: 'design',
    })
    expect(absent).toBe('Sửa dòng ')
  })
  test('toActionView drops the template and patterns, keeps attach_points/runner_id', () => {
    expect(toActionView(action())).toEqual({
      id: 'improve-doc',
      label: '✨ Cải thiện tài liệu',
      agent_ref: 'dev-agent-teams:doc-reviewer',
      confirm: true,
      attach_points: ['artifact-title'],
      require_approval: false,
    })
    expect(toActionView(action({ runner_id: 'r1' })).runner_id).toBe('r1')
    expect(toActionView(action({ require_approval: true })).require_approval).toBe(true)
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
  test('migrates a pre-QuickAction YAML (no attach_points) to title-only', async () => {
    fs.writeFileSync(
      path.join(root, 'artifact-actions.yaml'),
      [
        'version: 1',
        'actions:',
        '  - id: legacy',
        '    label: "Legacy action"',
        '    artifact_patterns: ["design.md"]',
        '    agent_ref: dev-agent-teams:doc-reviewer',
        '    prompt_template: "Đọc {{artifact_name}}"',
      ].join('\n'),
    )
    const loaded = await loadArtifactActions(root)
    expect(loaded[0].attach_points).toEqual(['artifact-title'])
  })
})

describe('loadArtifactActionsFile', () => {
  let root: string
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-file-root-'))
  })
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

  test('falls back to the built-in default catalog + version 1 when missing', async () => {
    const file = await loadArtifactActionsFile(root)
    expect(file.version).toBe(1)
    expect(file.actions).toEqual(DEFAULT_ARTIFACT_ACTIONS)
  })
  test('returns the full (unfiltered) action fields for CRUD, not the UI view', async () => {
    fs.writeFileSync(
      path.join(root, 'artifact-actions.yaml'),
      [
        'version: 3',
        'actions:',
        '  - id: a1',
        '    label: "Action 1"',
        '    artifact_patterns: ["design.md"]',
        '    agent_ref: dev-agent-teams:doc-reviewer',
        '    prompt_template: "Đọc {{artifact_name}}"',
        '    attach_points: ["artifact-selection"]',
        '    runner_id: r1',
      ].join('\n'),
    )
    const file = await loadArtifactActionsFile(root)
    expect(file.version).toBe(3)
    expect(file.actions[0].prompt_template).toBe('Đọc {{artifact_name}}')
    expect(file.actions[0].runner_id).toBe('r1')
    expect(file.actions[0].attach_points).toEqual(['artifact-selection'])
  })
})

describe('saveArtifactActions', () => {
  let root: string
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-save-root-'))
  })
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

  test('writes a valid catalog to disk, readable back via loadArtifactActionsFile', async () => {
    const result = await saveArtifactActions(root, {
      version: 2,
      actions: [action({ id: 'a1' }), action({ id: 'a2', attach_points: ['artifact-selection'] })],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.actions.map((a) => a.id)).toEqual(['a1', 'a2'])

    const reloaded = await loadArtifactActionsFile(root)
    expect(reloaded.version).toBe(2)
    expect(reloaded.actions.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(reloaded.actions[1].attach_points).toEqual(['artifact-selection'])
  })
  test('rejects a schema-invalid body without touching disk', async () => {
    const before = await loadArtifactActionsFile(root)
    const result = await saveArtifactActions(root, { version: 1, actions: [{ id: 'bad' }] })
    expect(result.ok).toBe(false)
    const after = await loadArtifactActionsFile(root)
    expect(after).toEqual(before)
  })
  test('rejects duplicate action ids', async () => {
    const result = await saveArtifactActions(root, {
      version: 1,
      actions: [action({ id: 'dup' }), action({ id: 'dup' })],
    })
    expect(result.ok).toBe(false)
    if (!('error' in result)) throw new Error('expected failure')
    expect(result.error).toContain('duplicate')
  })
})
