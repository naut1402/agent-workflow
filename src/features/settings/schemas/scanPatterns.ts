import { z } from 'zod'

/**
 * Custom scan patterns let a repo that ignores the default Claude Code / Cursor
 * conventions still expose its agents, skills and rules to the dashboard.
 *
 * Shared by server and UI, so this file must stay free of `node:*` / fileHelper
 * imports — every path check below is plain string work.
 */

export const SCAN_PATTERN_KINDS = ['agents', 'skills', 'rules'] as const

export type ScanPatternKind = (typeof SCAN_PATTERN_KINDS)[number]

export const SCAN_PATTERN_MAX_LENGTH = 200
export const SCAN_PATTERN_MAX_COUNT = 20

/**
 * Tolerant on input: a junk entry is dropped on its own instead of failing the
 * whole list, so one bad line hand-edited into settings.json cannot wipe the rest.
 */
const PatternList = z.preprocess((raw) => sanitiseList(raw), z.array(z.string()))

/** Custom scan patterns block inside global dashboard settings.json. */
export const ScanPatternsConfigSchema = z.object({
  agents: PatternList,
  skills: PatternList,
  rules: PatternList,
})

export type ScanPatternsConfig = z.infer<typeof ScanPatternsConfigSchema>

export const DEFAULT_SCAN_PATTERNS_CONFIG: ScanPatternsConfig = {
  agents: [],
  skills: [],
  rules: [],
}

/**
 * Normalise one pattern, returning null when it cannot be used.
 * Patterns are always relative to the project root — absolute paths, drive
 * letters, `~` and `..` are rejected so a pattern can never escape it.
 */
export function sanitiseScanPattern(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let p = raw.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  while (p.startsWith('./')) p = p.slice(2)
  p = p.replace(/\/+$/, '')
  if (!p || p === '.') return null
  if (p.length > SCAN_PATTERN_MAX_LENGTH) return null
  if (p.startsWith('/')) return null
  if (/^[A-Za-z]:/.test(p)) return null
  if (p.startsWith('~')) return null
  if (p.split('/').some((s) => s === '..')) return null
  return p
}

function sanitiseList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    const p = sanitiseScanPattern(item)
    if (p && !out.includes(p)) out.push(p)
    if (out.length >= SCAN_PATTERN_MAX_COUNT) break
  }
  return out
}

/** Bad entries are dropped silently, matching how parseAutoscanConfig treats junk. */
export function parseScanPatternsConfig(raw: unknown): ScanPatternsConfig {
  const parsed = ScanPatternsConfigSchema.safeParse(raw)
  if (!parsed.success) return { agents: [], skills: [], rules: [] }
  return parsed.data
}

/** True when at least one pattern is configured — lets callers skip the whole pattern branch. */
export function hasAnyScanPattern(config: ScanPatternsConfig | null | undefined): boolean {
  if (!config) return false
  return SCAN_PATTERN_KINDS.some((k) => (config[k]?.length ?? 0) > 0)
}
