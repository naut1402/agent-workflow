import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useApiAction, useKeyedApiAction } from '@/frontend/composables/useApiAction'

/**
 * Hợp đồng công khai của hook dùng chung cho mọi action API do người dùng bấm:
 * `pending` / `pendingKey` và giá trị trả về của `run`. 18 call site tiêu thụ
 * đúng ba thứ đó, nên đó là bề mặt được khoá ở đây — không phải các bước bên
 * trong `run`.
 *
 * `useApiAction` tự nó không đăng ký lifecycle hook nào, nhưng TC-06 kiểm hành
 * vi lúc unmount nên vẫn dựng host component thật (mẫu của `useCopyText.test.ts`).
 */

/** Cổng mở bằng tay — giữ promise treo mà không lẫn với fake timer. */
function gate() {
  let release!: () => void
  const p = new Promise<void>((r) => {
    release = r
  })
  return { wait: () => p, release }
}

function mountHost<T>(factory: () => T) {
  let api!: T
  const Host = defineComponent({
    setup() {
      api = factory()
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  return { wrapper, api }
}

const mountAction = () => mountHost(useApiAction)
const mountKeyed = () => mountHost(useKeyedApiAction)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useApiAction', () => {
  it('TC-01 · bật `pending` đồng bộ rồi nhả sau khi callee resolve', async () => {
    const { api } = mountAction()
    const g = gate()

    const p = api.run(async () => {
      await g.wait()
      return 'ok'
    })

    // ⚠️ Assert TRƯỚC mọi `await`: control bind `:disabled` phải chặn được ngay
    // cả khi request xong trong dưới một frame.
    expect(api.pending.value).toBe(true)

    g.release()
    await expect(p).resolves.toBe('ok')
    expect(api.pending.value).toBe(false)
  })

  it('TC-02 · callee throw thì nhả cờ và lỗi nổi ra NGUYÊN VẸN', async () => {
    const { api } = mountAction()
    const boom = Object.assign(new Error('Conflict'), { status: 409 })

    const p = api.run(async () => {
      throw boom
    })
    expect(api.pending.value).toBe(true)

    // `toBe(boom)` chứ không `toThrowError('Conflict')`: `QaPanel` map 409 và
    // 400 thành hai thông điệp khác nhau, nên `e.status` phải sống sót qua `run`.
    await expect(p).rejects.toBe(boom)
    expect(api.pending.value).toBe(false)
  })

  it('TC-03 · bấm lặp — lời gọi thứ hai bị bỏ qua, callee chạy đúng một lần', async () => {
    const { api } = mountAction()
    const g = gate()
    const callee = vi.fn(async () => {
      await g.wait()
      return 1
    })

    const p1 = api.run(callee)
    const p2 = api.run(callee)

    await expect(p2).resolves.toBeUndefined()
    expect(callee).toHaveBeenCalledTimes(1)
    // Phần dễ hỏng nhất: một `finally` đặt sai chỗ sẽ để lời gọi BỊ BỎ QUA nhả
    // cờ của lời gọi đang chạy.
    expect(api.pending.value).toBe(true)

    g.release()
    await p1
    expect(api.pending.value).toBe(false)
  })

  it('TC-04 · dùng lại được sau khi thành công', async () => {
    const { api } = mountAction()
    const callee = vi.fn(async () => 'first')

    await expect(api.run(callee)).resolves.toBe('first')

    // Guard bị chốt vĩnh viễn (quên nhả) vẫn xanh ở TC-03 nhưng làm mọi nút
    // trong app chỉ bấm được một lần.
    await expect(api.run(async () => 'second')).resolves.toBe('second')
    expect(api.pending.value).toBe(false)
  })

  it('TC-05 · dùng lại được sau khi LỖI', async () => {
    const { api } = mountAction()

    await expect(
      api.run(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    // "Không kẹt loading khi lỗi" không chỉ là `pending === false` (TC-02) mà
    // còn là thao tác mở lại được — hai điều do hai dòng code khác nhau bảo đảm.
    const g = gate()
    const second = api.run(async () => {
      await g.wait()
      return 'after-error'
    })
    expect(api.pending.value).toBe(true)

    g.release()
    await expect(second).resolves.toBe('after-error')
    expect(api.pending.value).toBe(false)
  })

  it('TC-06 · unmount giữa lúc request đang bay vẫn settle sạch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { wrapper, api } = mountAction()
    const g = gate()

    const p = api.run(async () => {
      await g.wait()
      return 'late'
    })
    wrapper.unmount()
    g.release()

    await expect(p).resolves.toBe('late')
    expect(api.pending.value).toBe(false)
    // Khoá quyết định E2: cố ý KHÔNG thêm cờ `disposed`. Ca này là bằng chứng
    // quyết định đó không đẻ cảnh báo, không phải test cho một tính năng.
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('useKeyedApiAction', () => {
  it('TC-07 · `pendingKey` giữ đúng key, `pending` suy ra đúng', async () => {
    const { api } = mountKeyed()
    const g = gate()

    const p = api.run('tpl-a', async () => {
      await g.wait()
      return 'saved'
    })
    expect(api.pendingKey.value).toBe('tpl-a')
    expect(api.pending.value).toBe(true)

    g.release()
    await expect(p).resolves.toBe('saved')
    expect(api.pendingKey.value).toBe(null)
    expect(api.pending.value).toBe(false)
  })

  it('TC-08 · throw vẫn nhả `pendingKey` về null và key khác chạy tiếp được', async () => {
    const { api } = mountKeyed()
    const boom = Object.assign(new Error('Bad Request'), { status: 400 })

    await expect(
      api.run('tpl-a', async () => {
        throw boom
      }),
    ).rejects.toBe(boom)
    expect(api.pendingKey.value).toBe(null)
    expect(api.pending.value).toBe(false)

    await expect(api.run('tpl-b', async () => 'ok')).resolves.toBe('ok')
  })

  it('TC-09 · một slot — đang chạy A thì B bị bỏ qua, xong A thì B chạy lại được', async () => {
    const { api } = mountKeyed()
    const g = gate()
    const fnA = vi.fn(async () => {
      await g.wait()
    })
    const fnB = vi.fn(async () => 'b')

    const pa = api.run('a', fnA)
    await expect(api.run('b', fnB)).resolves.toBeUndefined()
    expect(fnB).not.toHaveBeenCalled()
    // Ca bắt lỗi "ghi đè key" — chính là hành vi cũ mà design cố ý siết lại.
    expect(api.pendingKey.value).toBe('a')

    g.release()
    await pa
    await expect(api.run('b', fnB)).resolves.toBe('b')
    expect(fnB).toHaveBeenCalledTimes(1)
  })

  it.each(['', '0'])('TC-10 · key %o là key hợp lệ, không phải sentinel rảnh', async (key) => {
    // Code cũ dùng `''` và `-1` làm sentinel "không ai chạy"; code mới dùng
    // `null`. Một cài đặt `pending = computed(() => !!pendingKey.value)` xanh ở
    // mọi TC khác nhưng sai đúng ở hai giá trị này — và `WorkflowSectionEditor`
    // có item `index === 0`, tức hàng đầu của mọi danh sách.
    const { api } = mountKeyed()
    const g = gate()
    const other = vi.fn(async () => 'x')

    const p = api.run(key, async () => {
      await g.wait()
      return 'held'
    })
    expect(api.pendingKey.value).toBe(key)
    expect(api.pending.value).toBe(true)

    await expect(api.run('x', other)).resolves.toBeUndefined()
    expect(other).not.toHaveBeenCalled()

    g.release()
    await expect(p).resolves.toBe('held')
    expect(api.pendingKey.value).toBe(null)
    expect(api.pending.value).toBe(false)
  })
})
