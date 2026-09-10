import { AbstractController } from '../../core/http/AbstractController.js'
import { emitEntity } from '../../core/events/index.js'
import {
  CollectionsFileError,
  createCollection,
  deleteCollection,
  getKnowledgeDriver,
  listCollections,
  loadKnowledgeBundle,
  renameTag,
  updateCollection,
} from './business/index.js'
import {
  BundleQuery,
  CollectionBody,
  KnowledgeListQuery,
  KnowledgeUploadScope,
  KnowledgeWriteBody,
  MAX_BUNDLE_IDS,
  TagRenameBody,
} from './schemas/knowledge.js'

/**
 * Bề mặt HTTP của knowledge: entry CRUD + tag + collection + bundle.
 *
 * CORS, rate-limit và JWT **không** xuất hiện ở đây — middleware `/api/*` của
 * Hono đã lo cả ba; trước migrate feature này tự áp tay từng cái một.
 */
export class KnowledgeController extends AbstractController {
  private async driverFor() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    const { driver } = await getKnowledgeDriver(gate.root)
    return { driver, root: gate.root }
  }

  /**
   * Sidecar `collections.yaml` hỏng là lỗi **trạng thái trên đĩa**, không phải
   * lỗi request → 500 kèm đúng file hỏng để người dùng sửa tay được. Business
   * đã từ chối ghi trong ca này nên không có dữ liệu nào bị đè.
   */
  private async collectionOp(run: () => Promise<Response>): Promise<Response> {
    try {
      return await run()
    } catch (e) {
      if (e instanceof CollectionsFileError) return this.json(500, { error: e.message })
      throw e
    }
  }

  /** `?id=` phân biệt read và list: id chứa `/` nên không nhét vào path param. */
  async listOrReadEntry() {
    const d = await this.driverFor()
    if ('error' in d) return d.error
    const parsed = KnowledgeListQuery.safeParse(this.c.req.query())
    if (!parsed.success) return this.badRequest('invalid query')
    const { id, scope, tags, collection, q, include } = parsed.data

    if (id) {
      try {
        return this.ok({ entry: await d.driver.read(id) })
      } catch {
        return this.notFound('not found', { id })
      }
    }
    const params = {
      scope,
      query: q,
      collection,
      tags: tags ? tags.split(',').filter(Boolean) : undefined,
    }
    if (include === 'tags') return this.ok(await d.driver.listWithTags(params))
    return this.ok({ entries: await d.driver.list(params) })
  }

  async createEntry() {
    return this.writeEntry(201)
  }

  async updateEntry() {
    const id = this.c.req.query('id')
    if (!id) return this.badRequest('missing id')
    return this.writeEntry(200, id)
  }

  private async writeEntry(status: 200 | 201, id?: string) {
    const d = await this.driverFor()
    if ('error' in d) return d.error
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const parsed = KnowledgeWriteBody.safeParse(b.value)
    if (!parsed.success) return this.badRequest('invalid body')
    try {
      const entry = await d.driver.write({ ...parsed.data, ...(id ? { id } : {}) })
      emitEntity(status === 201 ? 'created' : 'updated', 'knowledge', {
        id: entry.id,
        projectId: this.projectId,
        detail: { scope: entry.scope },
      })
      return this.json(status, { entry })
    } catch (e) {
      return this.badRequest(String((e as Error)?.message ?? e))
    }
  }

  async deleteEntry() {
    const d = await this.driverFor()
    if ('error' in d) return d.error
    const id = this.c.req.query('id')
    if (!id) return this.badRequest('missing id')
    try {
      const result = await d.driver.delete(id)
      emitEntity('deleted', 'knowledge', { id: result.id, projectId: this.projectId })
      return this.ok(result)
    } catch {
      return this.notFound('not found', { id })
    }
  }

  async listTags() {
    const d = await this.driverFor()
    if ('error' in d) return d.error
    return this.ok({ tags: await d.driver.listTags() })
  }

  /**
   * Multipart qua `c.req.formData()` — cùng khuôn `readAttachmentForm` của
   * nl-chat. An toàn nhị phân có sẵn vì bridge node→Web gom body thành Buffer
   * chứ không phải string như bản parse tay trước đây.
   */
  async uploadEntry() {
    const d = await this.driverFor()
    if ('error' in d) return d.error
    let form: FormData
    try {
      form = await this.c.req.formData()
    } catch {
      return this.badRequest('invalid multipart body')
    }
    const file = form.get('file')
    if (!(file instanceof File)) return this.badRequest('no file content')
    const scope = KnowledgeUploadScope.safeParse(form.get('scope'))
    const tags = String(form.get('tags') ?? '')
      .split(/[,;]+/)
      .filter(Boolean)
    try {
      const entry = await d.driver.upload({
        filename: file.name,
        content: await file.text(),
        scope: scope.success ? scope.data : 'project',
        tags,
        title: String(form.get('title') ?? '') || undefined,
      })
      emitEntity('created', 'knowledge', {
        id: entry.id,
        projectId: this.projectId,
        detail: { scope: entry.scope },
      })
      return this.created({ entry })
    } catch (e) {
      return this.badRequest(String((e as Error)?.message ?? e))
    }
  }

  entryMethodNotAllowed() {
    return this.methodNotAllowed()
  }

  // ── collection ───────────────────────────────────────────────────────────

  async listCollections() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    return this.collectionOp(async () => this.ok(await listCollections(gate.root)))
  }

  async createCollection() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const parsed = CollectionBody.safeParse(b.value)
    if (!parsed.success) return this.badRequest('invalid body')
    return this.collectionOp(async () => {
      const result = await createCollection(gate.root, parsed.data)
      if ('error' in result) return this.json(result.status, { error: result.error })
      emitEntity('created', 'knowledge-collection', {
        id: result.collection.id,
        projectId: this.projectId,
        detail: { scope: result.collection.scope },
      })
      return this.created(result)
    })
  }

  async updateCollection() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const parsed = CollectionBody.safeParse(b.value)
    if (!parsed.success) return this.badRequest('invalid body')
    return this.collectionOp(async () => {
      const result = await updateCollection(gate.root, this.c.req.param('id'), parsed.data)
      if ('error' in result) return this.json(result.status, { error: result.error })
      emitEntity('updated', 'knowledge-collection', {
        id: result.collection.id,
        projectId: this.projectId,
        detail: { scope: result.collection.scope },
      })
      return this.ok(result)
    })
  }

  /** Xoá **nhóm**, không xoá tài liệu — entry trên đĩa giữ nguyên. */
  async deleteCollection() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    return this.collectionOp(async () => {
      const result = await deleteCollection(gate.root, this.c.req.param('id'))
      if ('error' in result) return this.json(result.status, { error: result.error })
      emitEntity('deleted', 'knowledge-collection', { id: result.id, projectId: this.projectId })
      return this.ok(result)
    })
  }

  async renameTag() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const parsed = TagRenameBody.safeParse(b.value)
    if (!parsed.success) return this.badRequest('invalid body')
    return this.collectionOp(async () => {
      const result = await renameTag(gate.root, parsed.data)
      // Rename hỏng giữa chừng vẫn đã ghi được một phần → emit cho đúng những
      // entry đó và trả cả danh sách, đừng để client tưởng không có gì đổi.
      for (const id of 'entries' in result ? result.entries : []) {
        emitEntity('updated', 'knowledge', { id, projectId: this.projectId })
      }
      if ('error' in result) return this.json(result.status, result)
      return this.ok(result)
    })
  }

  // ── bundle ───────────────────────────────────────────────────────────────

  /** Resolve `knowledge_inputs` (id) → nội dung cho agent chạy ngoài repo. */
  async getBundle() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const parsed = BundleQuery.safeParse(this.c.req.query())
    if (!parsed.success) return this.badRequest('invalid query')
    // Id lặp gộp lại, quá ngưỡng thì **từ chối** — cắt bớt im lặng nghĩa là
    // agent nhận bundle thiếu mà không có tín hiệu nào để tự phát hiện.
    const ids = [
      ...new Set(
        parsed.data.ids
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ]
    if (!ids.length) return this.badRequest('missing ids')
    if (ids.length > MAX_BUNDLE_IDS) {
      return this.badRequest(`too many ids (max ${MAX_BUNDLE_IDS})`, { count: ids.length })
    }
    return this.ok({ bundle: await loadKnowledgeBundle(gate.root, ids) })
  }
}
