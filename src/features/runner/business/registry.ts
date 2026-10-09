import { joinPath, mkdirSync, readTextFileSync, writeTextFileAtomicSync } from '../../../backend/lib/fileHelper.js'
import { registryHome } from '../../../backend/registry.js'
import { catalogFamilyOf, ensureLegacyConnection, getConnection } from './connections.js'
import { createClaudeCodeCliProvider } from './providers/claude-code-cli.js'
import { createCursorCliProvider } from './providers/cursor-cli.js'
import { createCodexCliProvider } from './providers/codex-cli.js'
import { createConsoleCommandProvider } from './providers/console-command.js'
import { createOpenAiCompatibleProvider } from './providers/openai-compatible-api.js'
import { createAnthropicCompatibleProvider } from './providers/anthropic-compatible-api.js'
import { providerFamilyFromId } from './providers/agentCli.js'
import {
  DEFAULT_CONNECTION_ID,
  RUNNERS_VERSION,
  sanitiseConnectionId,
  sanitiseRunnerId,
  type DefaultRunnerReason,
  type DefaultRunnerResolution,
  type ProviderFamily,
  type RunnerConfig,
  type RunnersStore,
  type MutationResult,
  type RunnerProvider,
} from './types.js'

function runnersFile(): string {
  return joinPath(registryHome(), 'runners.json')
}

function emptyRunners(): RunnersStore {
  return {
    version: RUNNERS_VERSION,
    defaultRunnerId: null,
    runners: [],
  }
}

function stripConnectionFieldsFromConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out = { ...config }
  delete out.cliPath
  delete out.flags
  return out
}

/** Normalize raw runner JSON (v1 provider+credentialId or v2 connectionId). */
export function normalizeRunner(raw: any): RunnerConfig | null {
  const id = sanitiseRunnerId(raw?.id)
  if (!id) return null

  let connectionId = sanitiseConnectionId(raw.connectionId)
  const config =
    raw.config && typeof raw.config === 'object' ? ({ ...raw.config } as Record<string, unknown>) : {}

  if (!connectionId && raw.provider) {
    connectionId = ensureLegacyConnection({
      provider: raw.provider,
      credentialId: raw.credentialId,
      cliPath: typeof config.cliPath === 'string' ? config.cliPath : undefined,
      flags: config.flags,
    })
  }
  if (!connectionId) connectionId = DEFAULT_CONNECTION_ID

  return {
    id,
    name: String(raw.name || id).slice(0, 128),
    connectionId,
    enabled: raw.enabled !== false,
    maxConcurrency: Number(raw.maxConcurrency) > 0 ? Number(raw.maxConcurrency) : 1,
    config: stripConnectionFieldsFromConfig(config),
  }
}

export function loadRunners(): RunnersStore {
  const file = runnersFile()
  let raw: string
  try {
    raw = readTextFileSync(file)
  } catch {
    // Chưa có file → danh sách trống (user tự tạo runner).
    return emptyRunners()
  }
  try {
    // Strip UTF-8 BOM (e.g. PowerShell Set-Content -Encoding utf8) so parse
    // does not fail and silently return an empty runner list.
    const data = JSON.parse(raw.replace(/^\uFEFF/, ''))
    if (!data || !Array.isArray(data.runners)) return emptyRunners()
    const runners = data.runners.map(normalizeRunner).filter(Boolean) as RunnerConfig[]
    // [] là trạng thái hợp lệ — không seed lại default.
    const defaultRunnerId =
      (data.defaultRunnerId && runners.some((r) => r.id === data.defaultRunnerId)
        ? data.defaultRunnerId
        : runners[0]?.id) || null
    return {
      version: RUNNERS_VERSION,
      defaultRunnerId,
      runners,
    }
  } catch {
    console.warn(`[dev-team-dashboard] runners.json corrupt: ${file}`)
    return emptyRunners()
  }
}

export function saveRunners(store: RunnersStore): RunnersStore {
  const home = registryHome()
  mkdirSync(home, { recursive: true })
  writeTextFileAtomicSync(runnersFile(), JSON.stringify(
    {
      version: store.version || RUNNERS_VERSION,
      defaultRunnerId: store.defaultRunnerId,
      runners: store.runners || [],
    },
    null,
    2,
  ))
  return store
}

export function listRunners(): {
  defaultRunnerId: string | null
  effectiveDefaultRunnerId: string | null
  defaultRunnerIssue: { runnerId: string | null; reason: DefaultRunnerReason } | null
  runners: RunnerConfig[]
} {
  const store = loadRunners()
  const d = resolveDefaultRunner(store)
  return {
    // `defaultRunnerId` giữ nguyên nghĩa cũ (id người dùng đã chốt); hai trường
    // dẫn xuất bên dưới cho UI biết runner nào job KHÔNG pin sẽ thật sự chạy.
    defaultRunnerId: store.defaultRunnerId,
    effectiveDefaultRunnerId: d.runner?.id ?? null,
    defaultRunnerIssue: d.reason === 'ok' ? null : { runnerId: d.runnerId, reason: d.reason },
    runners: store.runners,
  }
}

export function getRunner(id: unknown): RunnerConfig | null {
  const clean = sanitiseRunnerId(id)
  if (!clean) return null
  return loadRunners().runners.find((r) => r.id === clean) || null
}

/** Vì sao một runner KHÔNG đủ điều kiện làm default AI; `null` = đủ điều kiện. */
function defaultRunnerIssueOf(r: RunnerConfig): 'disabled' | 'no-connection' | 'not-ai' | null {
  if (r.enabled === false) return 'disabled'
  const conn = getConnection(r.connectionId)
  if (!conn?.providerId) return 'no-connection'
  const family = providerFamilyOf(conn.providerId)
  return family === 'agent-cli' || family === 'ai-api' ? null : 'not-ai'
}

/**
 * Nguồn sự thật duy nhất cho "runner nào chạy khi job không pin".
 *
 * Chỉ xét **đúng** runner đã được ghi nhận làm mặc định — không rơi về "runner hợp
 * lệ đầu tiên" nữa: rơi như vậy làm step chạy bằng runner người dùng chưa bao giờ
 * chọn. Thà đứng lại với lý do đọc được còn hơn chạy sai runner.
 *
 * `store` truyền vào để call site đã load rồi không phải đọc lại file.
 */
export function resolveDefaultRunner(store: RunnersStore = loadRunners()): DefaultRunnerResolution {
  if (!store.runners.length) return { runner: null, runnerId: null, reason: 'no-runners' }
  const id = store.defaultRunnerId
  if (!id) return { runner: null, runnerId: null, reason: 'unset' }
  const r = store.runners.find((x) => x.id === id)
  if (!r) return { runner: null, runnerId: id, reason: 'missing' }
  const issue = defaultRunnerIssueOf(r)
  return issue
    ? { runner: null, runnerId: id, reason: issue }
    : { runner: r, runnerId: id, reason: 'ok' }
}

/** Throttle theo cặp (id, reason) — hàm này chạy ở mọi lần submit job, không được spam log. */
let lastDefaultWarn = ''

/**
 * Đưa throttle về trạng thái biết trước. Chỉ dùng cho test: biến trên sống xuyên
 * process nên hai ca đo số dòng log trong cùng file sẽ ảnh hưởng nhau.
 */
export function resetDefaultRunnerWarn(): void {
  lastDefaultWarn = ''
}

export function getDefaultRunner(): RunnerConfig | null {
  const res = resolveDefaultRunner()
  if (res.reason !== 'ok') {
    const key = `${res.runnerId ?? '-'}:${res.reason}`
    if (key !== lastDefaultWarn) {
      lastDefaultWarn = key
      console.warn(
        `[runner] không có runner mặc định dùng được (${res.runnerId ?? 'chưa đặt'}: ${res.reason})`,
      )
    }
  } else {
    // Về `ok` thì xoá dấu, để lần hỏng sau vẫn được log một lần.
    lastDefaultWarn = ''
  }
  return res.runner
}

/** Agent CLI / AI API only — never console-command or unknown/missing provider. */
export function isEligibleDefaultAiRunner(r: RunnerConfig): boolean {
  return defaultRunnerIssueOf(r) === null
}

export function upsertRunner(runner: any): MutationResult<{ runner: RunnerConfig }> {
  const id = sanitiseRunnerId(runner?.id)
  if (!id) return { ok: false, error: 'invalid runner id' }

  // `create: true` chỉ do dialog "tạo mới" của FE gửi. Caller lập trình (test,
  // migration, automation) không gửi cờ này ⇒ giữ nguyên hành vi upsert-merge.
  // Id suy từ slugify(tên) nên trùng tên = trùng id: không chặn thì bản ghi mới
  // thay chỗ bản ghi cũ mà không ai thấy.
  //
  // Chặn TRƯỚC mọi tác dụng phụ: `ensureLegacyConnection` bên dưới ghi đĩa, nên
  // guard đặt sau nó sẽ để lại một connection mới rồi mới trả 409. 409 phải là
  // một no-op hoàn toàn.
  if (runner?.create === true && loadRunners().runners.some((r) => r.id === id)) {
    return { ok: false, status: 409, error: `runner id "${id}" đã tồn tại` }
  }

  let connectionId = sanitiseConnectionId(runner.connectionId)
  // Accept legacy payload during transition.
  if (!connectionId && runner.provider) {
    connectionId = ensureLegacyConnection({
      provider: runner.provider,
      credentialId: runner.credentialId,
      cliPath: runner.config?.cliPath,
      flags: runner.config?.flags,
    })
  }
  if (!connectionId) return { ok: false, error: 'connectionId is required' }

  const store = loadRunners()
  const entry: RunnerConfig = {
    id,
    name: String(runner.name || id).slice(0, 128),
    connectionId,
    enabled: runner.enabled !== false,
    maxConcurrency: Number(runner.maxConcurrency) > 0 ? Number(runner.maxConcurrency) : 1,
    config:
      runner.config && typeof runner.config === 'object'
        ? stripConnectionFieldsFromConfig({ ...runner.config })
        : {},
  }

  const idx = store.runners.findIndex((r) => r.id === id)
  if (idx >= 0) store.runners[idx] = { ...store.runners[idx], ...entry }
  else store.runners.push(entry)

  if (!store.defaultRunnerId || !store.runners.some((r) => r.id === store.defaultRunnerId)) {
    store.defaultRunnerId = store.runners.find((r) => isEligibleDefaultAiRunner(r))?.id || null
  }
  saveRunners(store)
  return { ok: true, runner: entry }
}

export function deleteRunner(id: unknown): MutationResult {
  const clean = sanitiseRunnerId(id)
  if (!clean) return { ok: false, status: 400, error: 'invalid id' }
  const store = loadRunners()
  const idx = store.runners.findIndex((r) => r.id === clean)
  if (idx < 0) return { ok: false, status: 404, error: 'not found' }
  store.runners.splice(idx, 1)
  if (store.defaultRunnerId === clean) {
    store.defaultRunnerId = store.runners.find((r) => isEligibleDefaultAiRunner(r))?.id || null
  }
  saveRunners(store)
  return { ok: true }
}

export function setDefaultRunner(id: unknown): MutationResult<{ defaultRunnerId: string }> {
  const clean = sanitiseRunnerId(id)
  if (!clean) return { ok: false, status: 400, error: 'invalid id' }
  const store = loadRunners()
  const runner = store.runners.find((r) => r.id === clean)
  if (!runner) {
    return { ok: false, status: 404, error: 'runner not found' }
  }
  const conn = getConnection(runner.connectionId)
  if (conn && conn.providerId === 'console-command') {
    return {
      ok: false,
      status: 400,
      error: 'console-command cannot be the default AI runner; pick an Agent CLI connection',
    }
  }
  store.defaultRunnerId = clean
  saveRunners(store)
  return { ok: true, defaultRunnerId: clean }
}

export function substituteConfig(
  config: Record<string, unknown> | undefined,
  vars: { projectRoot?: string },
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(config || {})) {
    if (typeof v === 'string') {
      out[k] = v.replace(/\$\{projectRoot\}/g, vars.projectRoot || '')
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        typeof item === 'string' ? item.replace(/\$\{projectRoot\}/g, vars.projectRoot || '') : item,
      )
    } else {
      out[k] = v
    }
  }
  return out
}

// ── CLI provider registry ──────────────────────────────────────────────────

const providers = new Map<string, RunnerProvider>()

function register(provider: RunnerProvider): void {
  providers.set(provider.providerId, provider)
}

register(createClaudeCodeCliProvider())
register(createCursorCliProvider())
register(createCodexCliProvider())
register(createConsoleCommandProvider())
register(createOpenAiCompatibleProvider('openai-api', 'https://api.openai.com/v1'))
register(createOpenAiCompatibleProvider('gemini-api', 'https://generativelanguage.googleapis.com/v1beta/openai'))
register(createOpenAiCompatibleProvider('xai-api', 'https://api.x.ai/v1'))
register(createAnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.com'))

/**
 * Register (or replace) a provider at runtime. Built-in providers are registered
 * at module load; this is the seam tests use to inject a stub provider (e.g. an
 * approval-flow provider that writes a proposed edit into the scratch workspace
 * without spawning a real CLI).
 */
export function registerProvider(provider: RunnerProvider): void {
  register(provider)
}

export function getProvider(providerId: string): RunnerProvider | null {
  return providers.get(providerId) || null
}

export function providerFamilyOf(providerId: string): ProviderFamily {
  return catalogFamilyOf(providerId) ?? providers.get(providerId)?.family ?? providerFamilyFromId(providerId)
}

export function listProviderIds(): string[] {
  return [...providers.keys()]
}

/** Vì sao step pin không dùng được — dùng cho log, không đổi hành vi (luôn fallback default). */
export type StepRunnerReason = 'unpinned' | 'pinned' | 'missing' | 'disabled' | 'ineligible'

export type StepRunnerResolution = { runnerId: string | undefined; reason: StepRunnerReason }

/**
 * Giải `steps[].runner_id` của một step thành runner id dùng được cho `submitJob`.
 *
 * `undefined` = để `submitJob` rơi về `getDefaultRunner()`. Mọi ca pin hỏng (runner
 * đã xoá / bị disable / không phải runner AI) đều về `undefined` thay vì fail cứng:
 * dọn danh sách runner không được làm đứng pipeline đang chạy.
 */
export function resolveStepRunnerId(step: unknown): StepRunnerResolution {
  const raw = (step as { runner_id?: unknown } | null)?.runner_id
  if (typeof raw !== 'string' || !raw.trim()) return { runnerId: undefined, reason: 'unpinned' }

  // So sánh bằng chứ không dùng bản đã gọt: `getRunner` sanitise bên trong, nên
  // một id rác kiểu `gem.ini` sẽ khớp nhầm sang runner `gemini`, và một id dài
  // hơn 64 ký tự sẽ bị cắt rồi khớp sang một runner khác hẳn.
  if (sanitiseRunnerId(raw) !== raw) return warnStepRunner(step, raw, 'missing')

  const runner = getRunner(raw)
  if (!runner) return warnStepRunner(step, raw, 'missing')
  if (runner.enabled === false) return warnStepRunner(step, raw, 'disabled')
  // Cùng điều kiện `getDefaultRunner` dùng — runner console-command không chạy agent được.
  if (!isEligibleDefaultAiRunner(runner)) return warnStepRunner(step, raw, 'ineligible')

  return { runnerId: runner.id, reason: 'pinned' }
}

/** Log nằm trong helper (không ở từng call site) để mọi đường start job cùng một thông điệp. */
function warnStepRunner(step: unknown, raw: string, reason: StepRunnerReason): StepRunnerResolution {
  const stepId = (step as { id?: unknown } | null)?.id
  console.warn(`[pipeline] step "${String(stepId)}" pinned runner "${raw}" ${reason} — dùng runner mặc định`)
  return { runnerId: undefined, reason }
}
