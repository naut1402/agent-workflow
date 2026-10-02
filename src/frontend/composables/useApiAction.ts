import { computed, ref, type ComputedRef } from 'vue'

/**
 * Cờ `pending` cho một action gọi API do NGƯỜI DÙNG bấm.
 *
 * Ba hợp đồng, và chỉ ba:
 * 1. `pending` bật ngay ms đầu — control bind `:disabled` chặn được bấm lặp
 *    không trễ một frame nào.
 * 2. `finally` luôn nhả cờ — thành công, lỗi, hay component đã unmount giữa
 *    chừng đều không kẹt loading.
 * 3. Lời gọi thứ hai khi lời gọi đầu chưa xong bị BỎ QUA (trả `undefined`),
 *    không xếp hàng — hai lần bấm "Lưu" phải gửi đúng một request.
 *
 * `pending` trả ra là `ComputedRef` (chỉ đọc) có chủ ý: chỉ `run` được sở hữu
 * vòng đời cờ. Một dòng reset tay sót lại ở call site (kiểu `saving.value =
 * false`) sẽ đỏ ở `typecheck` thay vì phá guard trong im lặng.
 *
 * KHÔNG bắt lỗi: `run` để lỗi nổi lên nguyên vẹn cho call site tự map thông
 * điệp như hiện tại. Công thức migrate giữ `try/catch` cũ NẰM TRONG callback
 * nên trên thực tế `run` không ném ra ngoài.
 *
 * 🚫 Không dùng cho polling hay SSE (`useAutomations` poll 10s, `sseClient`) —
 * overlay sẽ nháy liên tục dù người dùng không làm gì.
 */
export function useApiAction(): {
  pending: ComputedRef<boolean>
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>
} {
  const running = ref(false)
  const pending = computed(() => running.value)

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (running.value) return undefined
    running.value = true
    try {
      return await fn()
    } finally {
      running.value = false
    }
  }

  return { pending, run }
}

/**
 * Biến thể của `useApiAction` cho control lặp theo list: thay vì boolean, giữ
 * KEY của item đang chạy để template bind `pendingKey === key` — đúng hình
 * dạng mà `AgentSectionEditor` (`savingTemplate`) và `WorkflowSectionEditor`
 * (`savingIdx`) đang dùng sẵn.
 *
 * Một slot, đúng như hiện trạng: đang chạy item A thì bấm item B bị bỏ qua.
 * Đây là CHẶT HƠN hiện tại (bấm B đang ghi đè `savingTemplate`), có chủ ý.
 *
 * Trạng thái rảnh là `null`, KHÔNG phải chuỗi rỗng hay `-1`: `''` và `'0'` là
 * key hợp lệ (`WorkflowSectionEditor` có item `index === 0`), nên mọi so sánh
 * phải là `=== null` / `=== key`, không dựa truthiness.
 */
export function useKeyedApiAction(): {
  pendingKey: ComputedRef<string | null>
  pending: ComputedRef<boolean>
  run: <T>(key: string, fn: () => Promise<T>) => Promise<T | undefined>
} {
  const runningKey = ref<string | null>(null)
  const pendingKey = computed(() => runningKey.value)
  const pending = computed(() => runningKey.value !== null)

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (runningKey.value !== null) return undefined
    runningKey.value = key
    try {
      return await fn()
    } finally {
      runningKey.value = null
    }
  }

  return { pendingKey, pending, run }
}
