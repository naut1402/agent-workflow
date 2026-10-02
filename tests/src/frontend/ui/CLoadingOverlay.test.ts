import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestI18n, createTestI18nPlugin, mountWithI18n } from '../../helpers/i18n'
import CLoadingOverlay from '@/frontend/ui/CLoadingOverlay.vue'
import Icon from '@/frontend/ui/Icon.vue'

/**
 * Bề mặt test là DOM render ra từ prop — hợp đồng mà 11 call site tiêu thụ.
 *
 * ⚠️ jsdom không có layout cũng không có hit-testing: một `div` phủ `inset: 0`
 * ở đây KHÔNG ngăn `click` xuống phần tử bên dưới. Suite này khoá *thời điểm*
 * node chặn có mặt và *thời điểm* scrim được vẽ, không chứng minh được việc
 * phủ con trỏ — xem `test-spec.md` §5.
 */

// Gõ lại selector ở từng ca là cách `ChatWindow.test.ts:155` đẻ ra một
// assertion xanh giả sống sót qua nhiều lượt review (`.nl-chat-spinner` thay vì
// `.nl-chat-spin`). Một hằng số, dùng ở mọi nơi.
const OVERLAY = '.c-loading-overlay'
const DELAY_MS = 150
const MIN_VISIBLE_MS = 300

/** Fake `Date` là bắt buộc: `minVisibleMs` tính bằng `Date.now() - shownAt`. */
function useOverlayTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
}

function mountOverlay(props: Record<string, unknown> = {}) {
  return mountWithI18n(CLoadingOverlay, {
    props: { active: false, delayMs: DELAY_MS, minVisibleMs: MIN_VISIBLE_MS, ...props },
  })
}

/** Advance fake timer rồi nhường một vòng render cho Vue. */
async function tick(w: ReturnType<typeof mountOverlay>, ms: number) {
  vi.advanceTimersByTime(ms)
  await w.vm.$nextTick()
}

const isVisible = (w: ReturnType<typeof mountOverlay>): boolean =>
  w.find(OVERLAY).exists() && w.find(OVERLAY).classes().includes('is-visible')

beforeEach(() => {
  useOverlayTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CLoadingOverlay — chặn trước, vẽ sau', () => {
  it('TC-11 · `active` bật thì node chặn có mặt NGAY, nhưng chưa vẽ gì', async () => {
    const w = mountOverlay()
    await w.setProps({ active: true })

    // Chặn và vẽ là hai mốc thời gian tách rời (D6). "Đơn giản hoá" thành
    // `v-if="visible"` là để hở một khe `delayMs` mà click vẫn lọt xuống dưới.
    expect(w.find(OVERLAY).exists()).toBe(true)
    expect(w.find(OVERLAY).classes()).not.toContain('is-visible')
    expect(w.find(OVERLAY).attributes('aria-busy')).toBe('true')
    expect(w.find('[role="status"]').exists()).toBe(false)
    expect(w.findComponent(Icon).exists()).toBe(false)
    expect(w.find(OVERLAY).text()).toBe('')
  })

  it('TC-12 · qua `delayMs` mới vẽ; mốc 149 ms vẫn chưa vẽ', async () => {
    const w = mountOverlay()
    await w.setProps({ active: true })

    await tick(w, DELAY_MS - 1)
    expect(isVisible(w)).toBe(false)

    await tick(w, 1)
    expect(isVisible(w)).toBe(true)
    expect(w.find('[role="status"]').exists()).toBe(true)
    const icon = w.findComponent(Icon)
    expect(icon.props('name')).toBe('spinner')
    expect(icon.classes()).toContain('c-spin')
    expect(w.find(OVERLAY).text()).toBe('Đang xử lý…')
  })

  it('TC-13 · request nhanh (dưới `delayMs`) không bao giờ vẽ và node biến mất sạch', async () => {
    const w = mountOverlay()
    await w.setProps({ active: true })

    const seen: string[][] = [w.find(OVERLAY).classes()]
    await tick(w, DELAY_MS - 1)
    seen.push(w.find(OVERLAY).classes())

    await w.setProps({ active: false })
    seen.push(w.find(OVERLAY).exists() ? w.find(OVERLAY).classes() : [])
    await tick(w, 1000)
    seen.push(w.find(OVERLAY).exists() ? w.find(OVERLAY).classes() : [])

    expect(seen.flat()).not.toContain('is-visible')
    expect(w.find(OVERLAY).exists()).toBe(false)
  })
})

describe('CLoadingOverlay — chống nháy', () => {
  it('TC-14 · đã vẽ thì giữ đủ `minVisibleMs` mới tắt', async () => {
    const w = mountOverlay()
    await w.setProps({ active: true })
    await tick(w, DELAY_MS)
    expect(isVisible(w)).toBe(true)

    await tick(w, 50) // đã hiển thị 50 ms
    await w.setProps({ active: false })

    await tick(w, MIN_VISIBLE_MS - 50 - 1)
    expect(isVisible(w)).toBe(true)

    await tick(w, 1)
    expect(isVisible(w)).toBe(false)
    expect(w.find(OVERLAY).exists()).toBe(false)
  })

  it('TC-15 · hai action liên tiếp giữ overlay LIÊN TỤC, không tắt-bật', async () => {
    // Mốc thời gian (đồng hồ giả, ms): 0 bật · 150 vẽ (shownAt=150) · 200 action 1
    // xong → hideTimer tới 450 · 250 action 2 bắt đầu · 451 action 2 xong.
    const w = mountOverlay()
    await w.setProps({ active: true })
    await tick(w, DELAY_MS) // t=150, đã vẽ
    await tick(w, 50) // t=200
    expect(isVisible(w)).toBe(true)

    // Action 1 xong: hideTimer bắt đầu đếm nốt `minVisibleMs`.
    await w.setProps({ active: false })
    await tick(w, 50) // t=250, vẫn trong khe chờ ẩn
    expect(isVisible(w)).toBe(true)

    // Action 2 bắt đầu trong khe đó — overlay phải GIỮ NGUYÊN, không chớp.
    await w.setProps({ active: true })
    expect(isVisible(w)).toBe(true)
    await tick(w, 1) // t=251
    expect(isVisible(w)).toBe(true)
    await tick(w, 200) // t=451
    expect(isVisible(w)).toBe(true)

    // …và KHÔNG đếm lại `delayMs`. Mốc "đã hiển thị từ bao giờ" phải vẫn là mốc
    // của action 1 (t=150), nên tới t=451 overlay đã hiển thị 301 ms > 300 ms và
    // tắt phải TỨC THÌ. Một cài đặt đếm lại delay sẽ dời mốc đó sang t=400 — mới
    // hiển thị 51 ms — và còn giữ overlay thêm một nhịp. Đây là chỗ duy nhất
    // trong suite phân biệt được "giữ nguyên" với "vẽ lại sau `delayMs`".
    await w.setProps({ active: false })
    expect(isVisible(w)).toBe(false)
  })

  it('TC-17 · unmount lúc timer đang chờ không để lại timer mồ côi', async () => {
    const w = mountOverlay()
    await w.setProps({ active: true })
    await tick(w, 100) // showTimer chưa fire

    w.unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
  })
})

describe('CLoadingOverlay — nhãn', () => {
  it('TC-16 · nhãn mặc định lấy từ i18n, prop `label` ghi đè được', async () => {
    const w = mountOverlay()
    await w.setProps({ active: true })
    await tick(w, DELAY_MS)

    expect(w.find(OVERLAY).text()).toBe('Đang xử lý…')
    expect(w.find(OVERLAY).text()).not.toContain('common.loadingOverlay.label')

    const custom = mountOverlay({ active: true, label: 'Đang lưu riêng' })
    await tick(custom, DELAY_MS)
    expect(custom.find(OVERLAY).text()).toBe('Đang lưu riêng')
  })

  it('TC-18 · khoá i18n có đủ ở CẢ `vi` và `en`', async () => {
    // `mountWithI18n` chốt locale `vi`, nên nhánh `en` phải dựng plugin trực tiếp.
    const w = mount(CLoadingOverlay, {
      props: { active: true, delayMs: DELAY_MS, minVisibleMs: MIN_VISIBLE_MS },
      global: { plugins: [createTestI18nPlugin('en')] },
    })
    vi.advanceTimersByTime(DELAY_MS)
    await w.vm.$nextTick()
    expect(w.find(OVERLAY).text()).toBe('Working…')

    // Vue-i18n trả về nguyên key khi thiếu và chỉ cảnh báo — một khoá quên thêm
    // ở `en.ts` không làm đỏ test nào khác. Assert thẳng trên bundle.
    const key = 'common.loadingOverlay.label'
    for (const locale of ['vi', 'en'] as const) {
      expect(createTestI18n(locale).global.t(key)).not.toBe(key)
    }
  })
})
