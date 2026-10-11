import { access, joinPath, pathToFileURL, readDir, safeReadDir } from './fileHelper.js'

function defaultImportFiles(entryFile: string): string[] {
  if (entryFile.endsWith('.ts')) {
    return [entryFile.slice(0, -3) + '.js', entryFile]
  }
  return [entryFile]
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

/** Dynamic-import `dir/<file>` theo thứ tự `tryFiles` tới khi một file nạp được. */
async function importFirst<T>(dir: string, tryFiles: string[]): Promise<T> {
  let lastErr: unknown
  for (const file of tryFiles) {
    try {
      return (await import(pathToFileURL(joinPath(dir, file)).href)) as T
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

export type LoadEntriesUnderOptions = {
  /** File entry trong mỗi thư mục con, nạp theo đúng thứ tự này (vd `['api.ts', 'controller.ts']`). */
  entryFiles: string[]
  /** Thư mục con chứa nhiều entry (vd `['controllers']`) — mọi `*.ts` trong đó, sắp theo tên. */
  entryDirs?: string[]
}

export type LoadedEntry<T> = {
  /** Tên thư mục con của `rootDir` (vd tên feature). */
  dir: string
  /** Path entry tương đối trong thư mục con (vd `api.ts`, `controllers/jobs.ts`). */
  file: string
  mod: T
}

/**
 * Quét thư mục con trực tiếp của `rootDir`, dynamic-import nhiều entry mỗi thư mục: từng file trong `entryFiles`
 * có mặt, rồi mọi `*.ts` (trừ `.d.ts`) trong `entryDirs`. Thứ tự trả về: thư mục con theo
 * thứ tự đọc thư mục; trong một thư mục, theo thứ tự khai ở `opts`.
 *
 * Server/Bun only — do not import from Vite browser bundles.
 */
export async function loadEntriesUnder<T = unknown>(
  rootDir: string,
  opts: LoadEntriesUnderOptions,
): Promise<LoadedEntry<T>[]> {
  const entries = await readDir(rootDir, { withFileTypes: true })
  const out: LoadedEntry<T>[] = []

  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const dir = joinPath(rootDir, ent.name)

    for (const file of opts.entryFiles) {
      if (!(await exists(joinPath(dir, file)))) continue
      out.push({ dir: ent.name, file, mod: await importFirst<T>(dir, defaultImportFiles(file)) })
    }

    for (const sub of opts.entryDirs ?? []) {
      const names = (await safeReadDir(joinPath(dir, sub)))
        .filter((f) => f.isFile() && f.name.endsWith('.ts') && !f.name.endsWith('.d.ts'))
        .map((f) => f.name)
        .sort()
      for (const name of names) {
        const file = `${sub}/${name}`
        out.push({ dir: ent.name, file, mod: await importFirst<T>(dir, defaultImportFiles(file)) })
      }
    }
  }

  return out
}
