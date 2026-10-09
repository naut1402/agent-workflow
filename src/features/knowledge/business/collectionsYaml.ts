import { joinPath, readTextFile } from '../../../backend/lib/fileHelper.js'
import { loadYaml } from '../../../backend/lib/yamlLib.js'

export const COLLECTIONS_FILE = 'collections.yaml'

export interface YamlCollection {
  id: string
  name: string
  description?: string
  tags?: string[]
  entry_ids?: string[]
  created_at?: string
  updated_at?: string
}

export interface CollectionsDoc {
  version: number
  collections: YamlCollection[]
  tag_aliases: Record<string, string>
}

/** Sidecar không parse được — lệnh migrate phải dừng chứ không được coi là rỗng. */
export class CollectionsFileError extends Error {
  constructor(
    readonly base: string,
    cause?: unknown,
  ) {
    super(`collections.yaml không đọc được (${base}): ${(cause as Error)?.message ?? cause}`)
    this.name = 'CollectionsFileError'
  }
}

function emptyDoc(): CollectionsDoc {
  return { version: 1, collections: [], tag_aliases: {} }
}

/** Thiếu file → doc rỗng (sidecar vốn là tuỳ chọn). Parse hỏng → ném. */
export async function readCollectionsFile(base: string): Promise<CollectionsDoc> {
  let raw: string
  try {
    raw = await readTextFile(joinPath(base, COLLECTIONS_FILE))
  } catch {
    return emptyDoc()
  }
  let doc: any
  try {
    doc = loadYaml(raw) || {}
  } catch (e) {
    throw new CollectionsFileError(base, e)
  }
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    throw new CollectionsFileError(base, 'nội dung không phải mapping YAML')
  }
  return {
    version: Number(doc.version) || 1,
    collections: Array.isArray(doc.collections) ? doc.collections : [],
    tag_aliases: doc.tag_aliases && typeof doc.tag_aliases === 'object' ? doc.tag_aliases : {},
  }
}
