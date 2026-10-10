import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  listProviderCatalog,
  listRunners,
  providerFamilyOf,
  registerProvider,
  resolveDefaultRunner,
  setDefaultRunner,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'
import { providerFamilyOf as registryProviderFamilyOf } from '../../../../src/features/runner/business/registry.js'
import { providerFamilyFromId } from '../../../../src/features/runner/business/providers/agentCli.js'
import type { ProviderFamily, RunnerProvider } from '../../../../src/features/runner/business/types.js'

// T6fabee9b · G6 — `providerFamilyOf` phân loại theo khai báo (catalog → family
// provider tự khai) trước, quy tắc theo id chỉ là dự phòng cuối.

function stubProvider(providerId: string, family?: ProviderFamily): RunnerProvider {
  return {
    providerId,
    ...(family ? { family } : {}),
    validateRunnerConfig: () => ({ ok: true, errors: [] }),
    validateCredential: () => ({ ok: true, errors: [] }),
    capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
    execute: async () => ({ ok: true, exitCode: 0, durationMs: 1 }),
  } as RunnerProvider
}

const DECLARED_AI = 'stub-g6-declared-ai'
const DECLARED_SHELL_API = 'stub-g6-declared-shell-api'
const UNDECLARED_AGENT = 'stub-g6-undeclared'

registerProvider(stubProvider(DECLARED_AI, 'ai-api'))
registerProvider(stubProvider(DECLARED_SHELL_API, 'console-command'))
registerProvider(stubProvider(UNDECLARED_AGENT))

describe('providerFamilyOf — G6', () => {
  test('TC-G6-01: 8 provider trong catalog giữ nguyên family — luật mới và luật theo id cho cùng kết quả', () => {
    const catalog = listProviderCatalog()
    expect(catalog).toHaveLength(8)
    for (const e of catalog) {
      expect(providerFamilyOf(e.id)).toBe(e.family)
      expect(providerFamilyFromId(e.id)).toBe(e.family)
    }
  })

  test('TC-G6-02: provider tự khai `ai-api` với id không đuôi `-api` ⇒ `ai-api` (luật theo id cũ cho `console-command`)', () => {
    expect(providerFamilyFromId(DECLARED_AI)).toBe('console-command')
    expect(providerFamilyOf(DECLARED_AI)).toBe('ai-api')
  })

  test('TC-G6-03: provider tự khai `console-command` với id đuôi `-api` ⇒ `console-command`', () => {
    expect(providerFamilyFromId(DECLARED_SHELL_API)).toBe('ai-api')
    expect(providerFamilyOf(DECLARED_SHELL_API)).toBe('console-command')
  })

  test('TC-G6-04: không khai báo ở đâu ⇒ rơi về quy tắc theo id', () => {
    expect(providerFamilyOf(UNDECLARED_AGENT)).toBe('console-command')
    expect(providerFamilyOf('stub-g6-unregistered-api')).toBe('ai-api')
    expect(providerFamilyOf('stub-g6-unregistered')).toBe('console-command')
    expect(providerFamilyOf('')).toBe('console-command')
  })

  test('TC-G6-05: barrel `business/index` export đúng hàm của registry', () => {
    expect(providerFamilyOf).toBe(registryProviderFamilyOf)
  })
})

describe('providerFamilyOf — G6 ở runner mặc định', () => {
  let home: string
  const savedHome = process.env.DEV_TEAM_DASHBOARD_HOME

  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-provider-family-'))
    process.env.DEV_TEAM_DASHBOARD_HOME = home
  })
  afterAll(() => {
    if (savedHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
    else process.env.DEV_TEAM_DASHBOARD_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  })
  beforeEach(() => {
    for (const f of ['runners.json', 'connections.json']) fs.rmSync(path.join(home, f), { force: true })
  })

  function seedRunner(id: string, providerId: string) {
    upsertConnection({ id: `conn-${id}`, kind: 'local-console', providerId, cliPath: 'stub' })
    upsertRunner({ id, connectionId: `conn-${id}`, enabled: true, config: {} })
  }

  test('TC-G6-06: runner dùng provider tự khai `ai-api` (id không đuôi `-api`) đủ điều kiện làm default', () => {
    seedRunner('r-declared-ai', DECLARED_AI)
    setDefaultRunner('r-declared-ai')

    expect(resolveDefaultRunner().reason).toBe('ok')
    expect(listRunners().defaultRunnerIssue).toBeNull()
  })

  test('TC-G6-07: runner dùng provider tự khai `console-command` (id đuôi `-api`) KHÔNG đủ điều kiện ⇒ `not-ai`', () => {
    seedRunner('r-declared-shell', DECLARED_SHELL_API)
    setDefaultRunner('r-declared-shell')

    const res = resolveDefaultRunner()
    expect(res.reason).toBe('not-ai')
    expect(res.runner).toBeNull()
    expect(listRunners().defaultRunnerIssue).toEqual({ runnerId: 'r-declared-shell', reason: 'not-ai' })
  })
})
