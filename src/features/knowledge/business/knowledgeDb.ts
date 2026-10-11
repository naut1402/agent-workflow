import { getDb, type Db } from '../../../backend/db/client.js'
import { joinPath } from '../../../backend/lib/fileHelper.js'
import { globalKnowledgeRoot } from '../../../backend/registry.js'
import type { KnowledgeBases } from './drivers/FileKnowledgeDriver.js'

/**
 * Hạ tầng dùng chung cho hai module knowledge chạy trên `dashboard.sqlite`
 * (`collections.ts` và `tags.ts`), cùng bảng `scope → base` mà khoá
 * `store_key` và driver file cùng dựa vào (`resolveBases`).
 *
 * Không `import { Database } from 'bun:sqlite'` ở bất kỳ đâu trong feature:
 * `vite build` nạp `vite.config.ts` dưới Node và không resolve được scheme
 * `bun:` (AGENTS.md §4). Chỉ đi qua `getDb()` — nó đã dynamic import sẵn.
 */

/**
 * Không mở được DB là lỗi hạ tầng, phải nổi lên tới HTTP.
 *
 * Knowledge không có bất biến *append không bao giờ throw* của log: nuốt lỗi
 * ở đây thì nhóm collection/tag hiện thành "chưa có nhóm nào", người dùng tạo
 * mới và ghi đè mất dữ liệu cũ — im lặng, không khôi phục được.
 */
export class KnowledgeDbError extends Error {
  constructor(cause?: unknown) {
    super(`không mở được dashboard.sqlite: ${(cause as Error)?.message ?? cause}`)
    this.name = 'KnowledgeDbError'
  }
}

export async function knowledgeDb(): Promise<Db> {
  try {
    return await getDb()
  } catch (e) {
    throw new KnowledgeDbError(e)
  }
}

/**
 * Handle transaction của `db.transaction((tx) => …)`.
 *
 * Khai ra để module này chia được một transaction cho module khác: đổi tên tag
 * đụng ba bảng (alias · metadata · tag của collection) và cả ba phải cùng
 * thành/cùng bại, nhưng bảng metadata thuộc `tags.ts` còn transaction do
 * `collections.ts` mở.
 */
export type KnowledgeTx = Parameters<Parameters<Db['transaction']>[0]>[0]

export function knowledgeRoot(devTeamRoot: string): string {
  return joinPath(devTeamRoot, 'knowledge')
}

let globalScopeWarned = false

/**
 * Bảng tra `scope → base` — thuần path, không chạm đĩa. Nguồn chung của hai
 * thứ phải khớp nhau tuyệt đối: thư mục driver file đọc/ghi entry
 * (`knowledgeDriverRegistry.ts`) và khoá phân vùng `store_key` của mọi bảng
 * knowledge (`storeKeysOf`).
 *
 * Không mkdir ở đây — xem `FileKnowledgeDriver`.
 */
export function resolveBases(devTeamRoot: string): KnowledgeBases {
  const projectBase = knowledgeRoot(devTeamRoot)
  const bases: KnowledgeBases = { project: projectBase, system: projectBase }
  try {
    bases.global = globalKnowledgeRoot()
  } catch (e: any) {
    // Warn một lần: hàm này chạy ở đầu mọi thao tác, một vòng refresh của
    // panel đủ để log ngập cùng một dòng.
    if (!globalScopeWarned) {
      globalScopeWarned = true
      console.warn(`[knowledge] global scope disabled: ${e?.message ?? e}`)
    }
  }
  return bases
}

export interface KnowledgeStoreKeys {
  /** Scope của collection/tag (`project` | `global`) → khoá store. */
  byScope: Partial<Record<string, string>>
  /** Khoá store phân biệt — đường đọc gộp mọi store đi qua danh sách này. */
  all: string[]
}

/**
 * Khoá phân vùng của mọi bảng knowledge = đường dẫn store base, đúng chỗ
 * `collections.yaml` đang nằm hôm nay: `<root>/knowledge` cho `project` (và
 * `system`, vốn dùng chung base), `globalKnowledgeRoot()` cho `global`.
 *
 * Nhờ vậy migrate từ YAML là ánh xạ thẳng, và hai project khác thư mục không
 * bao giờ đọc nhầm dữ liệu của nhau.
 */
export function storeKeysOf(devTeamRoot: string): KnowledgeStoreKeys {
  const bases = resolveBases(devTeamRoot)
  const byScope: Partial<Record<string, string>> = {}
  if (bases.project) byScope.project = bases.project
  if (bases.global) byScope.global = bases.global
  return { byScope, all: [...new Set(Object.values(byScope).filter((v): v is string => !!v))] }
}
