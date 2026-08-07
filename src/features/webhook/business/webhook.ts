/**
 * GitHub webhook → @mention trigger (Epic F).
 */

import crypto from 'node:crypto'
import { joinPath, mkdirSync, readTextFileSync, renameSync, writeTextFileSync } from '../../../core/lib/fileHelper.js'
import { registryHome } from '../../../core/registry.js'
import { emit } from '../../../core/events/index.js'

export interface WebhookMentionMapping {
  /** Mentions without leading @, lowercased. */
  mention: string
  /** Optional pipeline profile name. */
  profileName?: string
  /** Optional agent ref. */
  agentRef?: string
  /** Optional runner id. */
  runnerId?: string
}

export interface WebhookProjectConfig {
  projectId: string
  /** GitHub webhook secret (plain — stored under dashboard home). */
  secret: string
  /** owner/repo filter; empty = any. */
  repo?: string
  mappings: WebhookMentionMapping[]
  enabled: boolean
}

export interface WebhookStore {
  version: 1
  projects: WebhookProjectConfig[]
}

function storeFile(): string {
  return joinPath(registryHome(), 'webhooks.json')
}

function emptyStore(): WebhookStore {
  return { version: 1, projects: [] }
}

export function loadWebhookStore(): WebhookStore {
  try {
    const raw = readTextFileSync(storeFile())
    const data = JSON.parse(raw) as WebhookStore
    if (!data || data.version !== 1 || !Array.isArray(data.projects)) return emptyStore()
    return data
  } catch {
    return emptyStore()
  }
}

export function saveWebhookStore(store: WebhookStore): void {
  mkdirSync(registryHome(), { recursive: true })
  const file = storeFile()
  const tmp = `${file}.tmp`
  writeTextFileSync(tmp, JSON.stringify(store, null, 2))
  renameSync(tmp, file)
}

export function upsertWebhookConfig(cfg: WebhookProjectConfig): WebhookProjectConfig {
  const store = loadWebhookStore()
  const entry: WebhookProjectConfig = {
    projectId: String(cfg.projectId),
    secret: String(cfg.secret || ''),
    repo: cfg.repo ? String(cfg.repo) : undefined,
    mappings: Array.isArray(cfg.mappings)
      ? cfg.mappings.map((m) => ({
          mention: String(m.mention || '')
            .replace(/^@/, '')
            .toLowerCase()
            .slice(0, 64),
          profileName: m.profileName,
          agentRef: m.agentRef,
          runnerId: m.runnerId,
        }))
      : [],
    enabled: cfg.enabled !== false,
  }
  const idx = store.projects.findIndex((p) => p.projectId === entry.projectId)
  if (idx >= 0) store.projects[idx] = entry
  else store.projects.push(entry)
  saveWebhookStore(store)
  return entry
}

export function getWebhookConfig(projectId: string): WebhookProjectConfig | null {
  return loadWebhookStore().projects.find((p) => p.projectId === projectId) || null
}

/** Verify `X-Hub-Signature-256: sha256=…` against raw body. */
export function verifyGithubSignature(rawBody: string, signatureHeader: string | null | undefined, secret: string): boolean {
  if (!secret || !signatureHeader) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  try {
    const a = Buffer.from(expected)
    const b = Buffer.from(String(signatureHeader))
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

const MENTION_RE = /@([A-Za-z0-9_-]+)/g

export function extractMentions(text: string): string[] {
  const found = new Set<string>()
  for (const m of text.matchAll(MENTION_RE)) {
    found.add(m[1].toLowerCase())
  }
  return [...found]
}

export interface WebhookHandleResult {
  ok: boolean
  status: number
  error?: string
  triggers?: Array<{ mention: string; mapping: WebhookMentionMapping; body: string }>
}

/**
 * Handle a GitHub issue_comment / pull_request_review_comment style payload.
 * Does not submit jobs itself — emits `webhook.triggered` for listeners / callers.
 */
export function handleGithubWebhook(opts: {
  projectId: string
  rawBody: string
  signature: string | null | undefined
  eventName?: string | null
}): WebhookHandleResult {
  const cfg = getWebhookConfig(opts.projectId)
  if (!cfg || !cfg.enabled) {
    return { ok: false, status: 404, error: 'webhook not configured' }
  }
  if (!verifyGithubSignature(opts.rawBody, opts.signature, cfg.secret)) {
    return { ok: false, status: 401, error: 'invalid signature' }
  }

  let payload: any
  try {
    payload = JSON.parse(opts.rawBody)
  } catch {
    return { ok: false, status: 400, error: 'invalid JSON' }
  }

  emit('webhook.received', {
    projectId: opts.projectId,
    event: opts.eventName || '',
    action: payload.action,
  })

  const repoFull = payload.repository?.full_name as string | undefined
  if (cfg.repo && repoFull && cfg.repo.toLowerCase() !== String(repoFull).toLowerCase()) {
    return { ok: true, status: 200, triggers: [] }
  }

  const body =
    (typeof payload.comment?.body === 'string' && payload.comment.body) ||
    (typeof payload.review?.body === 'string' && payload.review.body) ||
    (typeof payload.issue?.body === 'string' && payload.issue.body) ||
    ''

  const mentions = extractMentions(body)
  const triggers: WebhookHandleResult['triggers'] = []
  for (const mention of mentions) {
    const mapping = cfg.mappings.find((m) => m.mention === mention)
    if (!mapping) continue
    triggers!.push({ mention, mapping, body })
    emit('webhook.triggered', {
      projectId: opts.projectId,
      mention,
      mapping,
      prUrl: payload.pull_request?.html_url || payload.issue?.html_url,
      repo: repoFull,
    })
  }

  return { ok: true, status: 200, triggers }
}
