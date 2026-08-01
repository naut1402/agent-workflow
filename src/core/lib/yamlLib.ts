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
