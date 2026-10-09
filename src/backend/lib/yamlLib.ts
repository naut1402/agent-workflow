export { loadYaml, dumpYaml, parseFrontmatter } from '../../shared/lib/yamlLib'
import { loadYaml } from '../../shared/lib/yamlLib'

/**
 * Outcome of reading a YAML file: `missing` (no such file) is kept separate from `unreadable`
 * (present but cannot be read or parsed). `ok` carries `doc: null` for a non-object document.
 */
export type YamlRead =
  | { status: 'missing' }
  | { status: 'unreadable'; error: unknown }
  | { status: 'ok'; doc: Record<string, any> | null }

/** Load a YAML file, reporting *why* there is no document. */
export async function readYamlChecked(p: string): Promise<YamlRead> {
  let raw: string
  try {
    const fs = await import('node:fs/promises')
    raw = await fs.readFile(p, 'utf8')
  } catch (error: any) {
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
