import { describe, expect, test } from 'bun:test'
import {
  buildPluginContext,
  mergePromptWithContext,
  registerContextContributor,
  _resetContributorsForTest,
} from '../../../../src/core/plugin/index.js'

describe('plugin context', () => {
  test('merge knowledge into prompt', async () => {
    _resetContributorsForTest()
    registerContextContributor((ctx) => ({
      ...ctx,
      extras: { ...ctx.extras, Note: 'from plugin' },
    }))
    const ctx = await buildPluginContext({
      knowledgeBundle: { 'project/a': 'alpha' },
      branch: 'feat/x',
    })
    const prompt = mergePromptWithContext('do work', ctx)
    expect(prompt).toContain('feat/x')
    expect(prompt).toContain('alpha')
    expect(prompt).toContain('from plugin')
    expect(prompt).toContain('do work')
  })
})
