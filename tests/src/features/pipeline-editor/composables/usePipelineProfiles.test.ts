import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { usePipelineProfiles } from '@/features/pipeline-editor/composables/usePipelineProfiles'
import {
  fetchPipelineProfiles,
  fetchPipelineProfile,
  savePipelineProfile,
  deletePipelineProfile,
} from '@/features/pipeline-editor/scripts/ProfileManagerApi'

vi.mock('@/features/pipeline-editor/scripts/ProfileManagerApi', () => ({
  fetchPipelineProfiles: vi.fn(async () => ({ profiles: [{ name: 'p1' }] })),
  fetchPipelineProfile: vi.fn(async () => ({ pipeline: { steps: [] } })),
  savePipelineProfile: vi.fn(async () => ({ ok: true })),
  deletePipelineProfile: vi.fn(async () => ({ ok: true })),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchPipelineProfiles).mockResolvedValue({ profiles: [{ name: 'p1' }] } as any)
  vi.mocked(fetchPipelineProfile).mockResolvedValue({ pipeline: { steps: [] } } as any)
  vi.mocked(savePipelineProfile).mockResolvedValue({ ok: true } as any)
  vi.mocked(deletePipelineProfile).mockResolvedValue({ ok: true } as any)
})

describe('usePipelineProfiles — chuyển tiếp projectId', () => {
  it('refresh nạp danh sách và truyền projectId', async () => {
    const { profiles, refresh } = usePipelineProfiles(() => 'P1')
    await refresh()

    expect(fetchPipelineProfiles).toHaveBeenCalledWith('P1')
    expect(profiles.value).toEqual([{ name: 'p1' }])
  })

  it('projectId null đi ra thành undefined (project mặc định)', async () => {
    const { refresh } = usePipelineProfiles(() => null)
    await refresh()
    expect(fetchPipelineProfiles).toHaveBeenCalledWith(undefined)
  })

  it('load / save / remove gọi đúng hàm API kèm projectId', async () => {
    const { load, save, remove } = usePipelineProfiles(() => 'P1')

    await load('p1')
    expect(fetchPipelineProfile).toHaveBeenCalledWith('p1', 'P1')

    const pipeline = { version: 1, steps: [] }
    await save('p2', pipeline)
    expect(savePipelineProfile).toHaveBeenCalledWith('p2', pipeline, 'P1')

    await remove('p1')
    expect(deletePipelineProfile).toHaveBeenCalledWith('p1', 'P1')
  })

  it('load trả pipeline của profile', async () => {
    vi.mocked(fetchPipelineProfile).mockResolvedValue({ pipeline: { version: 7, steps: [] } } as any)
    const { load } = usePipelineProfiles(() => null)
    expect(await load('p1')).toEqual({ version: 7, steps: [] })
  })

  it('load với tên rỗng không gọi API', async () => {
    const { load } = usePipelineProfiles(() => null)
    expect(await load('')).toBeNull()
    expect(fetchPipelineProfile).not.toHaveBeenCalled()
  })

  it('đổi projectId tự nạp lại danh sách', async () => {
    const projectId = ref<string | null>('P1')
    usePipelineProfiles(() => projectId.value)

    projectId.value = 'P2'
    await nextTick()
    await Promise.resolve()

    expect(fetchPipelineProfiles).toHaveBeenCalledWith('P2')
  })
})

// Lỗi API không được ném ra ngoài — component gọi trong watcher/handler, throw
// ở đó chỉ tạo unhandled rejection chứ không giúp gì người dùng.
describe('usePipelineProfiles — lỗi API vào `error`, không throw', () => {
  it('refresh lỗi → error có nội dung, profiles rỗng', async () => {
    vi.mocked(fetchPipelineProfiles).mockRejectedValue(new Error('boom'))
    const { profiles, error, refresh } = usePipelineProfiles(() => null)

    await expect(refresh()).resolves.toBeUndefined()
    expect(error.value).toContain('boom')
    expect(profiles.value).toEqual([])
  })

  it('load lỗi → trả null', async () => {
    vi.mocked(fetchPipelineProfile).mockRejectedValue(new Error('nope'))
    const { error, load } = usePipelineProfiles(() => null)

    expect(await load('p1')).toBeNull()
    expect(error.value).toContain('nope')
  })

  it('save / remove lỗi → trả false', async () => {
    vi.mocked(savePipelineProfile).mockRejectedValue(new Error('write failed'))
    vi.mocked(deletePipelineProfile).mockRejectedValue(new Error('delete failed'))
    const { error, save, remove } = usePipelineProfiles(() => null)

    expect(await save('p1', {})).toBe(false)
    expect(error.value).toContain('write failed')

    expect(await remove('p1')).toBe(false)
    expect(error.value).toContain('delete failed')
  })

  it('lần gọi thành công sau đó xoá lỗi cũ', async () => {
    vi.mocked(fetchPipelineProfiles).mockRejectedValueOnce(new Error('boom'))
    const { error, refresh } = usePipelineProfiles(() => null)

    await refresh()
    expect(error.value).toContain('boom')

    await refresh()
    expect(error.value).toBe('')
  })

  it('loading về false kể cả khi API lỗi', async () => {
    vi.mocked(fetchPipelineProfiles).mockRejectedValue(new Error('boom'))
    const { loading, refresh } = usePipelineProfiles(() => null)

    await refresh()
    expect(loading.value).toBe(false)
  })
})
