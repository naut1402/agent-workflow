import { describe, expect, it } from 'vitest'
import {
  buildCreateTaskPreviewSummary,
  canAdvanceFromSourceStep,
  promptFromIssue,
  validateTaskId,
} from '@/features/monitor/lib/createTaskForm'

describe('createTaskForm', () => {
  describe('validateTaskId', () => {
    it('rejects empty id', () => {
      expect(validateTaskId('')).toBe('required')
      expect(validateTaskId('   ')).toBe('required')
    })

    it('rejects invalid charset', () => {
      expect(validateTaskId('-bad')).toBe('invalid')
      expect(validateTaskId('has space')).toBe('invalid')
      expect(validateTaskId('a'.repeat(65))).toBe('invalid')
    })

    it('accepts valid ids', () => {
      expect(validateTaskId('F0010')).toBeNull()
      expect(validateTaskId('B4488-fix')).toBeNull()
    })
  })

  describe('promptFromIssue', () => {
    it('uses server prompt when present', () => {
      expect(promptFromIssue({ title: 'T', body: null, url: 'https://x', prompt: 'from server' })).toBe(
        'from server',
      )
    })

    it('builds fallback brief from title/body/url', () => {
      const p = promptFromIssue({
        title: 'Bug',
        body: 'Steps',
        url: 'https://github.com/o/r/issues/1',
      })
      expect(p).toContain('# Bug')
      expect(p).toContain('https://github.com/o/r/issues/1')
      expect(p).toContain('Steps')
    })
  })

  describe('canAdvanceFromSourceStep', () => {
    it('requires prompt text for prompt source', () => {
      expect(canAdvanceFromSourceStep('F0010', 'prompt', '', '', false)).toBe(false)
      expect(canAdvanceFromSourceStep('F0010', 'prompt', 'hello', '', false)).toBe(true)
    })

    it('requires issue URL for issue source', () => {
      expect(canAdvanceFromSourceStep('F0010', 'issue', '', '', false)).toBe(false)
      expect(canAdvanceFromSourceStep('F0010', 'issue', 'x', 'https://github.com/a/b/issues/1', false)).toBe(
        true,
      )
    })
  })

  describe('buildCreateTaskPreviewSummary', () => {
    it('summarises form fields for preview', () => {
      const s = buildCreateTaskPreviewSummary({
        taskId: ' F0010 ',
        source: 'prompt',
        profileName: 'default',
        knowledgeInputs: ['project/a'],
        autoReview: true,
        exportJson: false,
        run: true,
        runnerLabel: 'Local',
        firstStepLabel: 'Investigate',
      })
      expect(s.taskId).toBe('F0010')
      expect(s.knowledgeCount).toBe(1)
      expect(s.runnerLabel).toBe('Local')
      expect(s.firstStepLabel).toBe('Investigate')
    })
  })
})
