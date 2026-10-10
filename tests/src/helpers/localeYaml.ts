import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadYaml } from '@/shared/lib/yamlLib'

const LOCALES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/shared/locales')

/** Messages của một namespace, đọc thẳng `src/shared/locales/<locale>/<namespace>.yaml`. */
export function localeMessages(locale: 'vi' | 'en', namespace: string): Record<string, any> {
  return loadYaml(readFileSync(path.join(LOCALES_DIR, locale, `${namespace}.yaml`), 'utf8')) as Record<string, any>
}
