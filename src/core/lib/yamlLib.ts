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
 * Load a YAML file; null on any error / non-object.
 * Uses dynamic `node:fs` so browser bundles that only import load/dump/frontmatter
 * can tree-shake this away.
 */
export async function readYamlSafe(p: string): Promise<Record<string, any> | null> {
  try {
    const fs = await import('node:fs/promises')
    const raw = await fs.readFile(p, 'utf8')
    const doc = loadYaml(raw)
    return doc && typeof doc === 'object' ? (doc as Record<string, any>) : null
  } catch {
    return null
  }
}
