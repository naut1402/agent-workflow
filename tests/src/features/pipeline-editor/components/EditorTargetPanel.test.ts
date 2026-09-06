import { describe, expect, it } from 'vitest'
import { mountWithI18n } from '../../../helpers/i18n'
import EditorTargetPanel from '@/features/pipeline-editor/components/EditorTargetPanel.vue'

// Panel thuần trình bày: mọi thao tác đi ra bằng emit, không tự gọi API và không
// tự đụng canvas — PipelineEditor giữ nguyên vai trò nơi duy nhất nạp/ghi.

const PROFILES = [{ name: 'p1' }, { name: 'p2' }]
const TASKS = [{ task_id: 'T1', name: 'Task một' }]

function mountPanel(props: Record<string, any> = {}) {
  return mountWithI18n(EditorTargetPanel, {
    props: { tab: 'profile', profiles: PROFILES, tasks: TASKS, ...props },
  })
}

describe('EditorTargetPanel — tab Profile', () => {
  it('select liệt kê profile của project, đổi select emit update:profileSelected', async () => {
    const w = mountPanel({ profileSelected: '' })
    const select = w.find('#editor-target-profile')
    expect(select.findAll('option').map((o) => o.attributes('value'))).toEqual(['', 'p1', 'p2'])

    await select.setValue('p2')

    expect(w.emitted('update:profileSelected')).toEqual([['p2']])
  })

  it('có ô nhập tên để lưu profile mới, gõ vào emit update:profileName', async () => {
    const w = mountPanel()
    await w.find('.target-input').setValue('profile-moi')
    expect(w.emitted('update:profileName')).toEqual([['profile-moi']])
  })

  it('a.1 — không còn nút Load profile', () => {
    const w = mountPanel({ profileSelected: 'p1' })
    const labels = w.findAll('button').map((b) => b.attributes('aria-label'))
    expect(labels.some((l) => /load/i.test(l ?? ''))).toBe(false)
  })

  // a.2 + docs/ui-buttons.md — icon button bắt buộc có title và aria-label qua t().
  it('nút delete / set-default / save là icon button có title + aria-label', () => {
    const w = mountPanel({ profileSelected: 'p1' })
    const buttons = w.findAll('.target-actions .icon-btn')
    expect(buttons.length).toBeGreaterThan(0)
    for (const b of buttons) {
      expect(b.attributes('type')).toBe('button')
      expect(b.attributes('title')).toBeTruthy()
      expect(b.attributes('aria-label')).toBeTruthy()
      expect(b.find('svg').exists()).toBe(true)
    }
  })

  it('nút xoá profile mang class danger và disabled khi chưa chọn profile', () => {
    const enabled = mountPanel({ profileSelected: 'p1' })
    const del = enabled.find('[aria-label="Xoá profile"]')
    expect(del.classes()).toContain('danger')
    expect(del.attributes('disabled')).toBeUndefined()

    const disabled = mountPanel({ profileSelected: '' })
    expect(disabled.find('[aria-label="Xoá profile"]').attributes('disabled')).toBeDefined()
  })

  it('a.3 — có nút set-as-default, emit set-default khi bấm', async () => {
    const w = mountPanel({ profileSelected: 'p1' })
    await w.find('[aria-label="Đặt làm mặc định"]').trigger('click')
    expect(w.emitted('set-default')).toHaveLength(1)
  })

  it('E10 — set-default disabled khi canvas rỗng', () => {
    const w = mountPanel({ setDefaultDisabled: true })
    expect(w.find('[aria-label="Đặt làm mặc định"]').attributes('disabled')).toBeDefined()
  })

  it('bấm Save emit save, không gọi gì khác', async () => {
    const w = mountPanel({ profileName: 'p1' })
    await w.find('[aria-label="Lưu"]').trigger('click')
    expect(w.emitted('save')).toHaveLength(1)
  })

  it('Save disabled theo prop saveDisabled / saving', () => {
    expect(mountPanel({ saveDisabled: true }).find('[aria-label="Lưu"]').attributes('disabled')).toBeDefined()
    expect(mountPanel({ saving: true }).find('[aria-label="Lưu"]').attributes('disabled')).toBeDefined()
  })
})

describe('EditorTargetPanel — tab Task', () => {
  it('1.1 — select đối tượng đổi thành select task', () => {
    const w = mountPanel({ tab: 'task', taskSelect: '' })
    expect(w.find('#editor-target-task').exists()).toBe(true)
    expect(w.find('#editor-target-profile').exists()).toBe(false)
  })

  it('b.1 — có select profile áp cho task, đổi chỉ emit update:taskProfile (không emit save)', async () => {
    const w = mountPanel({ tab: 'task' })
    await w.find('#editor-target-task-profile').setValue('p1')

    expect(w.emitted('update:taskProfile')).toEqual([['p1']])
    expect(w.emitted('save')).toBeUndefined()
  })

  it('ẩn delete profile và set-default ở tab Task', () => {
    const w = mountPanel({ tab: 'task', profileSelected: 'p1' })
    expect(w.find('[aria-label="Xoá profile"]').exists()).toBe(false)
    expect(w.find('[aria-label="Đặt làm mặc định"]').exists()).toBe(false)
    expect(w.find('[aria-label="Lưu"]').exists()).toBe(true)
  })

  it('option nhập tay hiện input mã task, gõ vào emit update:taskManual', async () => {
    const w = mountPanel({ tab: 'task', taskSelect: '__manual__' })
    await w.find('.target-input').setValue('T-ngoai-danh-sach')
    expect(w.emitted('update:taskManual')).toEqual([['T-ngoai-danh-sach']])
  })

  it('G6 — hiện cảnh báo gate khi cha truyền warning', () => {
    const w = mountPanel({ tab: 'task', warning: '⚠ đang chờ gate' })
    expect(w.find('.target-warning').text()).toContain('đang chờ gate')
  })
})

describe('EditorTargetPanel — trạng thái thu gọn', () => {
  it('G3 — chỉ render icon, không render select/input', () => {
    const w = mountPanel({ collapsed: true, profileSelected: 'p1' })
    expect(w.find('select').exists()).toBe(false)
    expect(w.find('input').exists()).toBe(false)
    expect(w.findAll('.target-actions--rail .icon-btn').length).toBeGreaterThan(0)
  })

  it('G4 — cụm action vẫn bấm được khi preview: hiện nút Stop', async () => {
    const w = mountPanel({ collapsed: true, previewing: true })
    const stop = w.find('[aria-label="Dừng"]')
    expect(stop.exists()).toBe(true)
    await stop.trigger('click')
    expect(w.emitted('stop')).toHaveLength(1)
  })

  it('bấm icon Agents/Rules ở dải thu gọn emit open-section kèm khoá', async () => {
    const w = mountPanel({ collapsed: true })
    const icons = w.findAll('.target-section-icon')
    expect(icons).toHaveLength(2)

    await icons[0].trigger('click')
    await icons[1].trigger('click')

    expect(w.emitted('open-section')).toEqual([['agents'], ['rules']])
  })
})
