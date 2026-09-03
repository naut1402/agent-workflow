import yaml from 'js-yaml'

const DEFAULT_DUMP: yaml.DumpOptions = { lineWidth: 120 }

/** Parse YAML string — throws on invalid YAML (callers that need soft-fail wrap try/catch). */
export function loadYaml(raw: string): unknown {
  return yaml.load(raw)
}

/** Serialize to YAML with project default line width. */
export function dumpYaml(doc: unknown, opts?: yaml.DumpOptions): string {
  return yaml.dump(doc, { ...DEFAULT_DUMP, ...opts })
}

/**
 * Parse a leading YAML frontmatter block (delimited by `---` lines).
 * Returns an empty object when there is no frontmatter or the YAML is invalid —
 * never throws (defensive by design).
 */
export function parseFrontmatter(raw: string): Record<string, any> {
  const lines = raw.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return {}
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (end < 0) return {}
  try {
    return (loadYaml(lines.slice(1, end).join('\n')) as Record<string, any>) || {}
  } catch {
    return {}
  }
}

/**
 * Outcome of reading a YAML file, keeping "there is no such file" separate from
 * "the file is there but unusable".
 *
 * `readYamlSafe` collapses both into `null`, which is fine for callers that just
 * want a default. It is NOT fine for a caller that infers something from the
 * *absence* of a value — "this pipeline declares no gate" must not be concluded
 * from a syntax error. A parse failure is missing evidence, not evidence of
 * absence.
 *
 * `ok` carries `doc: null` for a file that parses to a non-object (empty file,
 * a bare scalar): that is a well-formed "nothing here", not a failure.
 */
export type YamlRead =
  | { status: 'missing' }
  | { status: 'unreadable'; error: unknown }
  | { status: 'ok'; doc: Record<string, any> | null }

/**
 * Load a YAML file, reporting *why* there is no document.
 * Uses dynamic `node:fs` so browser bundles that only import load/dump/frontmatter
 * can tree-shake this away.
 */
export async function readYamlChecked(p: string): Promise<YamlRead> {
  let raw: string
  try {
    const fs = await import('node:fs/promises')
    raw = await fs.readFile(p, 'utf8')
  } catch (error: any) {
    // ENOENT / ENOTDIR (a missing parent dir) = genuinely no file here.
    // Anything else (EACCES, EISDIR, EMFILE, …) means a file may well exist and
    // we simply cannot see it — that is unreadable, not absent.
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { status: 'missing' }
    return { status: 'unreadable', error }
  }
  try {
    const doc = loadYaml(raw)
    return { status: 'ok', doc: doc && typeof doc === 'object' ? (doc as Record<string, any>) : null }
  } catch (error) {
    return { status: 'unreadable', error }
  }
}

/**
 * Load a YAML file; null on any error / non-object.
 * Prefer `readYamlChecked` when "file missing" and "file broken" must lead to
 * different behavior.
 */
export async function readYamlSafe(p: string): Promise<Record<string, any> | null> {
  const read = await readYamlChecked(p)
  return read.status === 'ok' ? read.doc : null
}
