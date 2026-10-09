import { getDb, type Db } from '../../../backend/db/client.js'
import { resolveBases } from './fileDriver.js'

// xem docs/agent-rules/coding-guideline.md §1

/**
 * Không mở được DB là lỗi hạ tầng, phải nổi lên tới HTTP.
 * xem docs/architecture/README.md §4.4
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
 * xem docs/architecture/code/knowledge.md §6
 */
export type KnowledgeTx = Parameters<Parameters<Db['transaction']>[0]>[0]

export interface KnowledgeStoreKeys {
  /** Scope của collection/tag (`project` | `global`) → khoá store. */
  byScope: Partial<Record<string, string>>
  /** Khoá store phân biệt — đường đọc gộp mọi store đi qua danh sách này. */
  all: string[]
}

/**
 * Khoá phân vùng của mọi bảng knowledge = đường dẫn store base: `<root>/knowledge`
 * cho `project` (và `system`, vốn dùng chung base), `globalKnowledgeRoot()` cho `global`.
 * xem docs/architecture/code/knowledge.md §2
 */
export function storeKeysOf(devTeamRoot: string): KnowledgeStoreKeys {
  const bases = resolveBases(devTeamRoot)
  const byScope: Partial<Record<string, string>> = {}
  if (bases.project) byScope.project = bases.project
  if (bases.global) byScope.global = bases.global
  return { byScope, all: [...new Set(Object.values(byScope).filter((v): v is string => !!v))] }
}
