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
