import { access, joinPath, pathToFileURL, readDir } from './fileHelper.js'

export type LoadModulesUnderOptions = {
  /** File that must exist for a child directory to be considered (e.g. `api.ts`). */
  entryFile: string
  /**
   * Import try order under each child dir. Default: if `entryFile` ends with `.ts`,
   * try the `.js` sibling first (Node ESM / Bun rewrite), then `entryFile`.
   */
  importFiles?: string[]
}

function defaultImportFiles(entryFile: string): string[] {
  if (entryFile.endsWith('.ts')) {
    return [entryFile.slice(0, -3) + '.js', entryFile]
  }
  return [entryFile]
}

/**
 * Scan direct child directories of `rootDir`; for each that contains `entryFile`,
 * dynamic-import the module (try `importFiles` in order until one succeeds).
 *
 * Server/Bun only — do not import from Vite browser bundles.
 */
export async function loadModulesUnder<T = unknown>(
  rootDir: string,
  opts: LoadModulesUnderOptions,
): Promise<T[]> {
  const tryFiles = opts.importFiles ?? defaultImportFiles(opts.entryFile)
  const entries = await readDir(rootDir, { withFileTypes: true })
  const mods: T[] = []

  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const dir = joinPath(rootDir, ent.name)
    try {
      await access(joinPath(dir, opts.entryFile))
    } catch {
      continue
    }

    let lastErr: unknown
    let loaded: T | undefined
    for (const file of tryFiles) {
      try {
        loaded = (await import(pathToFileURL(joinPath(dir, file)).href)) as T
        break
      } catch (err) {
        lastErr = err
      }
    }
    if (loaded === undefined) throw lastErr
    mods.push(loaded)
  }

  return mods
}
