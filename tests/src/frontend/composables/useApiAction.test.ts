import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, effectScope, h } from 'vue'
import { useApiAction, useKeyedApiAction } from '@/frontend/composables/useApiAction'

/**
 * Hợp đồng công khai của hook dùng chung cho mọi action API do người dùng bấm:
 * `pending` / `pendingKey` và giá trị trả về của `run`. 18 call site tiêu thụ
 * đúng ba thứ đó, nên đó là bề mặt được khoá ở đây — không phải các bước bên
 * trong `run`.
 *
 * `useApiAction` huỷ lượt đang chạy khi scope dispose (`onScopeDispose`), nên
 * các ca unmount dựng host component thật (mẫu của `useCopyText.test.ts`).
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

/** Callee treo tới khi signal bị huỷ, rồi reject đúng như `fetch` của trình duyệt. */
function abortable(signal: AbortSignal) {
  return new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })
}

describe('useApiAction — huỷ request', () => {
  it('TC-11 · callback nhận AbortSignal riêng cho từng lượt run', async () => {
    const { api } = mountAction()
    const seen: AbortSignal[] = []

    await api.run(async (signal) => {
      seen.push(signal)
    })
    await api.run(async (signal) => {
      seen.push(signal)
    })

    expect(seen).toHaveLength(2)
    expect(seen[0]).toBeInstanceOf(AbortSignal)
    expect(seen[0]).not.toBe(seen[1])
    expect(seen[0]!.aborted).toBe(false)
  })

  it('TC-12 · unmount khi đang chạy → signal bị huỷ, `pending` nhả, run trả undefined', async () => {
    const { wrapper, api } = mountAction()
    let captured!: AbortSignal

    const p = api.run((signal) => {
      captured = signal
      return abortable(signal)
    })
    expect(api.pending.value).toBe(true)

    wrapper.unmount()

    expect(captured.aborted).toBe(true)
    expect(api.pending.value).toBe(false)
    await expect(p).resolves.toBeUndefined()
  })

  it('TC-13 · lỗi huỷ không bị coi là lỗi thật — call site lọc bằng isAbortError', async () => {
    const { isAbortError } = await import('@/frontend/http/client')
    const { api } = mountAction()
    const shown: string[] = []

    const p = api.run(async (signal) => {
      try {
        await abortable(signal)
      } catch (e: any) {
        if (isAbortError(e)) return 'cancelled'
        shown.push(String(e.message))
      }
    })
    api.abort()

    await expect(p).resolves.toBe('cancelled')
    expect(shown).toEqual([])
  })

  it('TC-14 · abort() nhả `pending` ngay cả khi callback bỏ qua signal; lượt cũ xong muộn không phá lượt mới', async () => {
    const { api } = mountAction()
    const g1 = gate()
    const g2 = gate()

    const p1 = api.run(async () => {
      await g1.wait()
      return 'old'
    })
    api.abort()
    expect(api.pending.value).toBe(false)

    const p2 = api.run(async () => {
      await g2.wait()
      return 'new'
    })
    expect(api.pending.value).toBe(true)

    g1.release()
    await expect(p1).resolves.toBe('old')
    // `finally` của lượt cũ không được nhả cờ của lượt đang chạy.
    expect(api.pending.value).toBe(true)

    g2.release()
    await expect(p2).resolves.toBe('new')
    expect(api.pending.value).toBe(false)
  })

  it('TC-15 · AbortError KHÔNG do run huỷ (signal chưa abort) vẫn nổi ra nguyên vẹn', async () => {
    const { api } = mountAction()
    const foreign = new DOMException('timeout from elsewhere', 'AbortError')

    await expect(
      api.run(async () => {
        throw foreign
      }),
    ).rejects.toBe(foreign)
    expect(api.pending.value).toBe(false)
  })

  it('TC-16 · lỗi thật xảy ra SAU khi abort vẫn nổi ra', async () => {
    const { api } = mountAction()
    const g = gate()
    const boom = new Error('boom')

    const p = api.run(async () => {
      await g.wait()
      throw boom
    })
    api.abort()
    g.release()

    await expect(p).rejects.toBe(boom)
  })

  it('TC-17 · abort() khi rảnh là no-op', () => {
    const { api } = mountAction()
    expect(() => api.abort()).not.toThrow()
    expect(api.pending.value).toBe(false)
  })

  it('TC-18 · dùng ngoài component: không cảnh báo, scope dispose thì huỷ', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const bare = useApiAction()
    await expect(bare.run(async () => 'ok')).resolves.toBe('ok')

    const scope = effectScope()
    const scoped = scope.run(() => useApiAction())!
    let captured!: AbortSignal
    const p = scoped.run((signal) => {
      captured = signal
      return abortable(signal)
    })
    scope.stop()

    expect(captured.aborted).toBe(true)
    expect(scoped.pending.value).toBe(false)
    await expect(p).resolves.toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('useKeyedApiAction — huỷ request', () => {
  it('TC-19 · unmount huỷ signal và nhả `pendingKey` về null', async () => {
    const { wrapper, api } = mountKeyed()
    let captured!: AbortSignal

    const p = api.run('tpl-a', (signal) => {
      captured = signal
      return abortable(signal)
    })
    expect(api.pendingKey.value).toBe('tpl-a')

    wrapper.unmount()

    expect(captured.aborted).toBe(true)
    expect(api.pendingKey.value).toBe(null)
    expect(api.pending.value).toBe(false)
    await expect(p).resolves.toBeUndefined()
  })

  it('TC-20 · abort() rồi chạy key khác được ngay', async () => {
    const { api } = mountKeyed()

    const pa = api.run('a', (signal) => abortable(signal))
    api.abort()
    await expect(pa).resolves.toBeUndefined()

    await expect(api.run('b', async () => 'b')).resolves.toBe('b')
  })
})
