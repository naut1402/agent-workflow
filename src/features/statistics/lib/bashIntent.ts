/**
 * Bash command analysis — split one `Bash` tool call into shell segments and
 * label each segment with the intent it serves.
 *
 * Pure on purpose (no `node:*`): this bucket is also reachable from the frontend
 * graph, like `format.ts` next to it.
 *
 * Bash is 91% of measured tool calls and the average call chains ~5 segments, so
 * every frequency number in the report depends on this split being right.
 */

export const BASH_INTENTS = [
  'read',
  'grep',
  'list',
  'find',
  'curl',
  'git',
  'script',
  'cd',
  'write',
] as const
export type BashIntent = (typeof BASH_INTENTS)[number]

export interface BashCallAnalysis {
  segments: string[]
  /** SET semantics — one call carries each intent at most once, so intent shares sum above 100%. */
  intents: BashIntent[]
  /** `cd` to an absolute path — the 74% of Bash calls that only exist because cwd resets. */
  hasAbsoluteCd: boolean
}

interface PendingHeredoc {
  label: string
  /** `<<-` strips leading tabs, so the terminator may be indented. */
  dash: boolean
}

/** `<<LABEL`, `<<'LABEL'`, `<<"LABEL"`, `<<-LABEL` — but never `<<<` (here-string). */
const HEREDOC_RE = /^<<(-?)(?!<)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/

/** Leading `FOO=bar` assignments before the real binary. */
const LEADING_ASSIGN_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|[^\s]*)\s+)+/

const INTENT_BY_BINARY: Record<string, BashIntent> = {
  cat: 'read',
  head: 'read',
  tail: 'read',
  bat: 'read',
  less: 'read',
  grep: 'grep',
  rg: 'grep',
  ag: 'grep',
  ack: 'grep',
  ls: 'list',
  tree: 'list',
  find: 'find',
  fd: 'find',
  curl: 'curl',
  wget: 'curl',
  git: 'git',
  bun: 'script',
  node: 'script',
  python: 'script',
  python3: 'script',
  sh: 'script',
  bash: 'script',
  cd: 'cd',
  tee: 'write',
  mv: 'write',
  cp: 'write',
  rm: 'write',
  mkdir: 'write',
  touch: 'write',
}

/**
 * Swallow a heredoc body from `start` (the newline that opens it) up to and
 * including its terminator line. Unterminated heredoc → swallow to end of input,
 * which is what the shell effectively does with a truncated command and keeps the
 * splitter from inventing segments out of the script body.
 */
function heredocBodyEnd(command: string, start: number, pending: PendingHeredoc): number {
  let i = start
  while (i < command.length) {
    const nl = command.indexOf('\n', i)
    const lineEnd = nl === -1 ? command.length : nl
    const line = command.slice(i, lineEnd)
    // POSIX: the terminator must be alone on its line; `<<-` additionally allows
    // leading tabs. `echo EOF now` therefore does NOT close the heredoc.
    const candidate = pending.dash ? line.replace(/^[\t ]+/, '') : line
    if (candidate.replace(/\r$/, '') === pending.label) {
      return lineEnd === command.length ? lineEnd : lineEnd + 1
    }
    if (nl === -1) return command.length
    i = nl + 1
  }
  return command.length
}

/**
 * Length of the segment separator starting at `i`, or 0 when there is none.
 *
 * `|` is deliberately one separator whether or not it is doubled: a pipe and an
 * `||` both end the current segment, and only the width differs.
 */
function separatorLength(command: string, i: number): number {
  const ch = command[i]
  if (ch === '&' && command[i + 1] === '&') return 2
  if (ch === '|') return command[i + 1] === '|' ? 2 : 1
  if (ch === ';') return 1
  return 0
}

/**
 * Characters that must be copied through without ever being read as syntax:
 * anything inside quotes, and anything escaped by a backslash.
 *
 * Returns how many characters were consumed (0 when `i` is not such a run) plus the
 * quote still open afterwards, so the caller keeps one `quote` variable and no
 * nested branching.
 */
function consumeLiteral(
  command: string,
  i: number,
  quote: string | null,
): { taken: number; quote: string | null } | null {
  const ch = command[i]
  if (quote) return { taken: 1, quote: ch === quote ? null : quote }
  if (ch === '\\' && i + 1 < command.length) return { taken: 2, quote: null }
  if (ch === "'" || ch === '"') return { taken: 1, quote: ch }
  return null
}

/** The heredoc opener starting at `i`, or `null` — `<` is the only thing that can start one. */
function heredocAt(command: string, i: number): RegExpExecArray | null {
  return command[i] === '<' ? HEREDOC_RE.exec(command.slice(i)) : null
}

/**
 * Index just past the newline at `i` — or past the whole heredoc body when one is
 * pending, since the body and its terminator belong to the command that opened it.
 */
function lineEnd(command: string, i: number, pending: PendingHeredoc | null): number {
  return pending ? heredocBodyEnd(command, i + 1, pending) : i + 1
}

/** The raw split, before assignment prefixes are stripped and blanks dropped. */
function scanRawSegments(command: string): string[] {
  const raw: string[] = []
  let current = ''
  let quote: string | null = null
  let pending: PendingHeredoc | null = null
  let i = 0

  const flush = () => {
    raw.push(current)
    current = ''
  }

  while (i < command.length) {
    const ch = command[i]

    const literal = consumeLiteral(command, i, quote)
    if (literal) {
      current += command.slice(i, i + literal.taken)
      quote = literal.quote
      i += literal.taken
      continue
    }

    const heredoc = heredocAt(command, i)
    if (heredoc) {
      pending = { label: heredoc[3], dash: heredoc[1] === '-' }
      current += heredoc[0]
      i += heredoc[0].length
      continue
    }

    if (ch === '\n') {
      const end = lineEnd(command, i, pending)
      // Keep the heredoc body on the opening command; a bare newline just ends it.
      if (pending) current += command.slice(i, end)
      pending = null
      i = end
      flush()
      continue
    }

    const sep = separatorLength(command, i)
    if (sep) {
      flush()
      i += sep
      continue
    }

    current += ch
    i++
  }
  flush()
  return raw
}

/**
 * Split a command into shell segments.
 *
 * Two traps the naive `split(/&&|\|\||;|\|/)` falls into, both measured:
 *   - a heredoc body gets counted as commands (`// grep` inside an embedded
 *     script becomes a `grep` segment),
 *   - an operator inside quotes splits a single command (`grep 'a|b' f` is ONE
 *     command in a real shell, and regex alternation is common in these calls).
 *
 * The scan itself is `scanRawSegments`; this adds the normalisation pass.
 */
export function splitCommandSegments(command: string): string[] {
  if (typeof command !== 'string' || !command) return []

  const out: string[] = []
  for (const segment of scanRawSegments(command)) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    // `FOO=bar cmd -x` is a run of `cmd -x`; a bare `TOKEN=abc` is not a command
    // at all and stays unclassified rather than becoming one.
    const stripped = trimmed.replace(LEADING_ASSIGN_RE, '').trim()
    out.push(stripped || trimmed)
  }
  return out
}

/** Binary at the head of a segment, without its path or any assignment prefix. */
function binaryOf(segment: string): string {
  const head = segment.trim().split(/\s+/)[0] ?? ''
  const base = head.split('/').pop() ?? head
  return base.replace(/^['"]|['"]$/g, '')
}

/** `>` / `>>` outside quotes — `echo x > out.txt` writes even though `echo` does not. */
function hasRedirect(segment: string): boolean {
  let quote: string | null = null
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (ch === '>') return true
  }
  return false
}

/**
 * Label one segment, or `null` when the binary is not one we track.
 *
 * `sed` is flag-sensitive: `sed -n` prints (a read), `sed -i` edits in place (a
 * write), and a plain `sed` filter is neither.
 */
export function classifySegment(segment: string): BashIntent | null {
  if (typeof segment !== 'string') return null
  const trimmed = segment.trim()
  if (!trimmed) return null

  // A heredoc body is an embedded script no matter which binary consumes it.
  if (/<<-?\s*['"]?[A-Za-z_][A-Za-z0-9_]*/.test(trimmed)) return 'script'

  const binary = binaryOf(trimmed)
  if (binary === 'sed') {
    if (/(^|\s)-[a-zA-Z]*i/.test(trimmed)) return 'write'
    if (/(^|\s)-[a-zA-Z]*n/.test(trimmed)) return 'read'
    return null
  }

  const intent = INTENT_BY_BINARY[binary]
  if (intent) return intent
  return hasRedirect(trimmed) ? 'write' : null
}

/** Absolute `cd` — `cd /repo` yes, `cd ../x` no. */
function isAbsoluteCd(segment: string): boolean {
  const parts = segment.trim().split(/\s+/)
  if (parts[0] !== 'cd') return false
  const target = parts[1]
  return typeof target === 'string' && target.replace(/^['"]/, '').startsWith('/')
}

/** Split + classify one Bash call. `intents` is deduplicated; `segments` is not. */
export function classifyBashCall(text: string): BashCallAnalysis {
  const segments = splitCommandSegments(text)
  const intents: BashIntent[] = []
  let hasAbsoluteCd = false

  for (const segment of segments) {
    if (isAbsoluteCd(segment)) hasAbsoluteCd = true
    const intent = classifySegment(segment)
    if (intent && !intents.includes(intent)) intents.push(intent)
  }

  return { segments, intents, hasAbsoluteCd }
}

/**
 * The single label a call contributes to the command-sequence (bigram) analysis.
 *
 * `cd` is skipped unless it is the only thing the call does: 74% of measured Bash
 * calls open with an absolute `cd` purely because cwd resets between calls. Taking
 * it as the label would make almost every pair `cd → cd` and hide the read/grep
 * survey loop that is the actual finding.
 */
export function primaryIntentOf(text: string): BashIntent | null {
  let fallback: BashIntent | null = null
  for (const segment of splitCommandSegments(text)) {
    const intent = classifySegment(segment)
    if (!intent) continue
    if (intent !== 'cd') return intent
    fallback ??= intent
  }
  return fallback
}
