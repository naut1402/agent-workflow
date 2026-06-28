import yaml from 'js-yaml'

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
    return (yaml.load(lines.slice(1, end).join('\n')) as Record<string, any>) || {}
  } catch {
    return {}
  }
}
