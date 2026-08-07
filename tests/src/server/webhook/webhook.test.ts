import { describe, expect, test } from 'bun:test'
import {
  extractMentions,
  verifyGithubSignature,
  handleGithubWebhook,
  upsertWebhookConfig,
} from '../../../../src/features/webhook/business/webhook.js'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

describe('webhook', () => {
  test('extractMentions', () => {
    expect(extractMentions('please @Bot-Fix and @review')).toEqual(['bot-fix', 'review'])
  })

  test('verify signature + trigger mapping', () => {
    const prev = process.env.DEV_TEAM_DASHBOARD_HOME
    const home = path.join(os.tmpdir(), `wh-${Date.now()}`)
    process.env.DEV_TEAM_DASHBOARD_HOME = home
    try {
      upsertWebhookConfig({
        projectId: 'p1',
        secret: 's3cret',
        mappings: [{ mention: 'devbot', agentRef: 'plugin:investigator' }],
        enabled: true,
      })
      const body = JSON.stringify({
        action: 'created',
        comment: { body: 'hey @devbot please fix' },
        repository: { full_name: 'org/repo' },
      })
      const sig =
        'sha256=' + crypto.createHmac('sha256', 's3cret').update(body, 'utf8').digest('hex')
      const bad = handleGithubWebhook({ projectId: 'p1', rawBody: body, signature: 'sha256=dead' })
      expect(bad.ok).toBe(false)
      expect(verifyGithubSignature(body, sig, 's3cret')).toBe(true)
      const ok = handleGithubWebhook({ projectId: 'p1', rawBody: body, signature: sig })
      expect(ok.ok).toBe(true)
      expect(ok.triggers?.length).toBe(1)
      expect(ok.triggers?.[0]?.mention).toBe('devbot')
    } finally {
      if (prev === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
      else process.env.DEV_TEAM_DASHBOARD_HOME = prev
    }
  })
})
