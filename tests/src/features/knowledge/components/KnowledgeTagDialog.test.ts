import { mountWithI18n as mount } from '../../../helpers/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import KnowledgeTagDialog from '@/features/knowledge/components/KnowledgeTagDialog.vue'
import { TAG_COLORS } from '@/features/knowledge/schemas/knowledge'

/**
 * Dialog tạo/sửa tag — gộp luôn cụm "đổi tên tag" vốn nằm rời ở cột trái.
 *
 * Bất biến đắt nhất: đổi tên gọi `rename` **trước** rồi mới `PUT` metadata.
 * Ngược thứ tự là ghi màu cho một tag chưa entry nào mang.
 */

const createKnowledgeTag = vi.fn()
const saveKnowledgeTag = vi.fn()
const renameKnowledgeTag = vi.fn()
const calls: string[] = []

vi.mock('@/features/knowledge/scripts/KnowledgePanelApi', () => ({
  createKnowledgeTag: (...a: unknown[]) => createKnowledgeTag(...a),
  saveKnowledgeTag: (...a: unknown[]) => saveKnowledgeTag(...a),
  renameKnowledgeTag: (...a: unknown[]) => renameKnowledgeTag(...a),
}))

const TAG = { tag: 'alpha', count: 2, color: 'blue', description: 'mô tả', scope: 'project' }

const mountDialog = (tag: Record<string, unknown> | null = null, props: Record<string, unknown> = {}) =>
  mount(KnowledgeTagDialog, { props: { tag, ...props } })

const save = async (w: ReturnType<typeof mountDialog>) => {
  await w.find('.modal-foot .btn-primary').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  createKnowledgeTag.mockImplementation(async (body: any) => {
    calls.push('create')
    return { tag: { tag: body.tag, color: body.color, description: '', scope: body.scope } }
  })
  saveKnowledgeTag.mockImplementation(async () => {
    calls.push('put')
    return { tag: TAG }
  })
  renameKnowledgeTag.mockImplementation(async () => {
    calls.push('rename')
    return { renamed: 2, alias: ['alpha', 'beta'] }
  })
})

describe('KnowledgeTagDialog — bảng màu', () => {
  it('render đủ 8 token của palette, mỗi nút có title + aria-label', () => {
    const swatches = mountDialog().findAll('.knowledge-color-swatch')
    expect(swatches).toHaveLength(TAG_COLORS.length)
    for (const s of swatches) {
      expect(s.attributes('title')).toBeTruthy()
      expect(s.attributes('aria-label')).toBeTruthy()
    }
  })

  it('mỗi ô màu đặt biến inline theo TÊN token, không hardcode hex', () => {
    const styles = mountDialog().findAll('.knowledge-color-swatch').map((s) => s.attributes('style'))
    expect(styles[0]).toContain(`--tag-c: var(--tag-${TAG_COLORS[0]})`)
    for (const s of styles) expect(s).not.toMatch(/#[0-9a-f]{6}/i)
  })

  it('chọn màu thì gửi lên TÊN token, không phải hex', async () => {
    const w = mountDialog()
    await w.find('input.cfg-input').setValue('moi')
    const purple = TAG_COLORS.indexOf('purple')
    await w.findAll('.knowledge-color-swatch')[purple].trigger('click')
    await save(w)

    expect(createKnowledgeTag).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'moi', color: 'purple' }),
      undefined,
    )
  })

  it('sửa tag thì ô màu hiện tại được đánh dấu active', () => {
    const w = mountDialog(TAG)
    const blue = TAG_COLORS.indexOf('blue')
    expect(w.findAll('.knowledge-color-swatch')[blue].classes()).toContain('active')
  })
})

describe('KnowledgeTagDialog — tạo mới', () => {
  it('có ô tên; nút Lưu khoá khi tên trống', async () => {
    const w = mountDialog()
    expect(w.text()).toContain('Tên tag')
    expect(w.find('.modal-foot .btn-primary').attributes('disabled')).toBeDefined()

    await w.find('input.cfg-input').setValue('moi')
    expect(w.find('.modal-foot .btn-primary').attributes('disabled')).toBeUndefined()
  })

  it('lưu xong phát `saved` với cờ created', async () => {
    const w = mountDialog()
    await w.find('input.cfg-input').setValue('moi')
    await save(w)
    expect(w.emitted('saved')?.[0]).toEqual(['moi', true])
    expect(renameKnowledgeTag).not.toHaveBeenCalled()
  })

  it('`Lưu` đứng TRƯỚC `Hủy`', () => {
    expect(mountDialog().find('.modal-foot').findAll('button').map((b) => b.text())).toEqual(['Lưu', 'Hủy'])
  })

  it('lỗi API hiện ra trong dialog, không đóng im lặng', async () => {
    createKnowledgeTag.mockRejectedValue(new Error('tag already exists: moi'))
    const w = mountDialog()
    await w.find('input.cfg-input').setValue('moi')
    await save(w)

    expect(w.find('.err').text()).toContain('already exists')
    expect(w.emitted('saved')).toBeUndefined()
  })
})

describe('KnowledgeTagDialog — sửa tag', () => {
  it('không đổi tên ⇒ chỉ gọi PUT metadata, KHÔNG gọi rename', async () => {
    const w = mountDialog(TAG)
    await save(w)

    expect(calls).toEqual(['put'])
    expect(saveKnowledgeTag).toHaveBeenCalledWith(
      'alpha',
      expect.objectContaining({ color: 'blue', description: 'mô tả', scope: 'project' }),
      undefined,
    )
    expect(w.emitted('saved')?.[0]).toEqual(['alpha', false])
  })

  /** Thứ tự quan trọng: `PUT` phải nhận tên **mới**, tức phải chạy sau `rename`. */
  it('đổi tên ⇒ gọi rename TRƯỚC rồi PUT với tên MỚI', async () => {
    const w = mountDialog(TAG)
    await w.find('input.cfg-input').setValue('beta')
    await save(w)

    expect(calls).toEqual(['rename', 'put'])
    expect(renameKnowledgeTag).toHaveBeenCalledWith('alpha', 'beta', undefined)
    expect(saveKnowledgeTag.mock.calls[0][0]).toBe('beta')
    expect(w.emitted('renamed')?.[0]).toEqual([2, ''])
  })

  it('gõ đúng tên cũ vào ô đổi tên ⇒ coi như không đổi', async () => {
    const w = mountDialog(TAG)
    await w.find('input.cfg-input').setValue('alpha')
    await save(w)
    expect(calls).toEqual(['put'])
  })

  /**
   * E8 — `rename` đã dời metadata trong cùng transaction, nên hỏng bước `PUT`
   * chỉ nghĩa là tag mới **giữ màu cũ**: 🚫 không entry nào mất, và vẫn phải
   * coi là thành công để người dùng không chạy lại rename lần hai.
   */
  it('rename xong mà PUT hỏng ⇒ vẫn phát `renamed`, kèm nguyên nhân', async () => {
    saveKnowledgeTag.mockRejectedValue(new Error('db busy'))
    const w = mountDialog(TAG)
    await w.find('input.cfg-input').setValue('beta')
    await save(w)

    expect(w.emitted('renamed')?.[0]).toEqual([2, 'db busy'])
    expect(w.emitted('saved')).toBeUndefined()
  })

  it('rename hỏng ngay từ bước một ⇒ báo lỗi, KHÔNG phát renamed', async () => {
    renameKnowledgeTag.mockRejectedValue(new Error('đổi tag thất bại'))
    const w = mountDialog(TAG)
    await w.find('input.cfg-input').setValue('beta')
    await save(w)

    expect(w.find('.err').text()).toContain('đổi tag thất bại')
    expect(saveKnowledgeTag).not.toHaveBeenCalled()
    expect(w.emitted('renamed')).toBeUndefined()
  })

  /** Ghi lại đúng store đang giữ metadata — nếu không, tag global đẻ thêm hàng project. */
  it('mặc định scope theo store của tag, không cứng `project`', async () => {
    const w = mountDialog({ ...TAG, scope: 'global' })
    await save(w)
    expect(saveKnowledgeTag.mock.calls[0][1]).toMatchObject({ scope: 'global' })
  })

  it('projectId được truyền xuống mọi lời gọi', async () => {
    const w = mountDialog(TAG, { projectId: 'p1' })
    await w.find('input.cfg-input').setValue('beta')
    await save(w)
    expect(renameKnowledgeTag).toHaveBeenCalledWith('alpha', 'beta', 'p1')
    expect(saveKnowledgeTag.mock.calls[0][2]).toBe('p1')
  })
})
