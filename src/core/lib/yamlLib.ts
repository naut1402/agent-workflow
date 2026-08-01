import fs from 'node:fs/promises'
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

/** Load a YAML file; null on any error / non-object. */
export async function readYamlSafe(p: string): Promise<Record<string, any> | null> {
  try {
    const raw = await fs.readFile(p, 'utf8')
    const doc = yaml.load(raw)
    return doc && typeof doc === 'object' ? (doc as Record<string, any>) : null
  } catch {
    return null
  }
}
