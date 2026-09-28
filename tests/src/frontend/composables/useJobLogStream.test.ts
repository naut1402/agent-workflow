import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref, type Ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'

// `start()` reads the transport flag before opening either branch (Tfe0c91ca —
// SSE migration, D2 tuỳ chọn job-log). Mặc định ép 'sse' — case polling
// (regression, TC16) override lại 'polling' riêng.
vi.mock('@/frontend/lib/dashboardTransport', () => ({
  ensureDashboardTransport: vi.fn().mockResolvedValue('sse'),
  isSseEnabled: (t: string) => t !== 'polling',
}))
vi.mock('@/features/logs/scripts/logsApi', () => ({
  fetchJobLog: vi.fn(),
}))

import { useJobLogStream } from '@/frontend/composables/useJobLogStream'
import { ensureDashboardTransport } from '@/frontend/lib/dashboardTransport'
import { fetchJobLog } from '@/features/logs/scripts/logsApi'
import { makeSseStream } from '../../helpers/sseStream'

const fetchJobLogMock = vi.mocked(fetchJobLog)
const mounted: VueWrapper[] = []

/**
 * `useJobLogStream` gọi `onUnmounted(() => stop())` — mount trong một
 * component thật để hook có instance mà gắn vào (giống khuôn
 * `useAutomations.test.ts`), thay vì gọi trần ngoài `setup()`.
 */
function makeJobLogStream(jobId: Ref<string | null>, opts: Parameters<typeof useJobLogStream>[1] = {}) {
  let api!: ReturnType<typeof useJobLogStream>
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useJobLogStream(jobId, opts)
        return () => h('div')
      },
    }),
  )
  mounted.push(wrapper)
  return api
}

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.mocked(ensureDashboardTransport).mockResolvedValue('sse')
})

describe('useJobLogStream — SSE transport (test-spec.md Nhóm 4)', () => {
  it('TC11: mở xem log job đang chạy, nhận nội dung hiện có (text/size/status) ngay khi kết nối', async () => {
    const sse = makeSseStream()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => ({ ok: true, body: sse.stream }))
    vi.stubGlobal('fetch', fetchMock)

    const jobId = ref<string | null>('job-1')
    const s = makeJobLogStream(jobId)
    await vi.waitUntil(() => fetchMock.mock.calls.length > 0)

    sse.push('log', { text: 'hello\n', size: 6, reset: true, status: 'running', exitCode: null, eof: false })
    await vi.waitUntil(() => s.text.value.length > 0)

    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/jobs/job-1/log/stream')
    expect(s.text.value).toBe('hello\n')
    expect(s.offset.value).toBe(6)
    expect(s.status.value).toBe('running')
  })

  it('TC12: job sinh thêm output qua nhiều frame → nối tiếp, không lặp/mất dòng nào', async () => {
    const sse = makeSseStream()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL) => ({ ok: true, body: sse.stream })))

    const jobId = ref<string | null>('job-2')
    const s = makeJobLogStream(jobId)
    sse.push('log', { text: 'line1\n', size: 6, reset: true, status: 'running', eof: false })
    await vi.waitUntil(() => s.text.value === 'line1\n')

    sse.push('log', { text: 'line2\n', size: 12, status: 'running', eof: false })
    await vi.waitUntil(() => s.text.value === 'line1\nline2\n')
    expect(s.offset.value).toBe(12)
  })

  it('TC12: job kết thúc → status + exitCode cuối cùng được phản ánh đúng', async () => {
    const sse = makeSseStream()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL) => ({ ok: true, body: sse.stream })))

    const jobId = ref<string | null>('job-3')
    const s = makeJobLogStream(jobId)
    sse.push('log', { text: 'running...\n', size: 11, reset: true, status: 'running', eof: false })
    await vi.waitUntil(() => s.text.value.length > 0)

    sse.push('log', { text: '', size: 11, status: 'succeeded', exitCode: 0, eof: true })
    await vi.waitUntil(() => s.status.value === 'succeeded')
    expect(s.exitCode.value).toBe(0)
    expect(s.eof.value).toBe(true)
  })

  it('TC13: log bị cắt/reset ở nguồn (truncation) — thay nguyên nội dung, không lẫn cũ/mới', async () => {
    const sse = makeSseStream()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL) => ({ ok: true, body: sse.stream })))

    const jobId = ref<string | null>('job-4')
    const s = makeJobLogStream(jobId)
    sse.push('log', { text: 'phần cũ dài\n', size: 12, reset: true, status: 'running', eof: false })
    await vi.waitUntil(() => s.text.value.length > 0)

    // File log bị rotate/reset ở phía nguồn — server phát hiện size < offset cũ,
    // gửi `reset: true` kèm nội dung mới từ đầu (xem readJobLogDelta).
    sse.push('log', { text: 'log mới\n', size: 8, reset: true, status: 'running', eof: false })
    await vi.waitUntil(() => s.text.value === 'log mới\n')
    expect(s.offset.value).toBe(8)
  })

  /**
   * review.md [should] src/frontend/composables/useJobLogStream.ts:67-123 —
   * nhánh SSE không đóng stream khi job vào trạng thái terminal, không đối
   * xứng với `pollOnce()` (nhánh REST) trả `false` khi `isJobLogTerminal(status)`
   * hoặc `data.eof` để `runLoop()` thoát hẳn `while`, không còn network activity
   * cho job đã xong. Test này khoá đúng bất biến đó cho nhánh SSE — mirror hành
   * vi `pollOnce()`: khi `eof` chuyển `true`, client phải đóng
   * EventSource/stream (gọi `stream.close()`), không được giữ kết nối mở vô
   * thời hạn (kéo theo server-side `setInterval` ở
   * `LogsController.streamJobLog` chạy mãi mỗi 2.5s cho một job sẽ không bao
   * giờ đổi nữa).
   */
  it('TC12 + review.md [should]: job kết thúc (eof=true) → client đóng stream, mirror pollOnce() trả false', async () => {
    const sse = makeSseStream()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL) => ({ ok: true, body: sse.stream })))
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')

    const jobId = ref<string | null>('job-5')
    const s = makeJobLogStream(jobId)
    sse.push('log', { text: 'đang chạy\n', size: 10, reset: true, status: 'running', eof: false })
    await vi.waitUntil(() => s.text.value.length > 0)
    expect(abortSpy).not.toHaveBeenCalled()

    sse.push('log', { text: '', size: 10, status: 'succeeded', exitCode: 0, eof: true })
    await vi.waitUntil(() => s.status.value === 'succeeded')

    expect(abortSpy).toHaveBeenCalled()
  })
})

describe('useJobLogStream — polling transport (test-spec.md TC16, hồi quy)', () => {
  afterEach(() => {
    vi.mocked(ensureDashboardTransport).mockResolvedValue('sse')
  })

  it('TC16: transport=polling — vẫn dùng REST delta-poll y hệt trước khi migrate, không mở SSE', async () => {
    vi.mocked(ensureDashboardTransport).mockResolvedValue('polling')
    const sseFetch = vi.fn()
    vi.stubGlobal('fetch', sseFetch)
    fetchJobLogMock.mockResolvedValueOnce({ text: 'poll 1\n', size: 7, status: 'running', eof: false } as any)
    fetchJobLogMock.mockResolvedValueOnce({ text: '', size: 7, status: 'succeeded', exitCode: 0, eof: true } as any)

    const jobId = ref<string | null>('job-6')
    const s = makeJobLogStream(jobId, { waitMs: 5 })
    await vi.waitUntil(() => s.status.value === 'succeeded')

    expect(s.text.value).toBe('poll 1\n')
    expect(s.exitCode.value).toBe(0)
    // Nhánh polling gọi REST qua `fetchJobLog` (mocked), không mở kết nối SSE nào.
    expect(sseFetch).not.toHaveBeenCalled()
  })
})
