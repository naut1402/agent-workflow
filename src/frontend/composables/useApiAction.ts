import { computed, ref, type ComputedRef } from 'vue'

/**
 * Cờ `pending` cho một action gọi API do người dùng bấm: bật ngay khi gọi, luôn nhả ở `finally`;
 * lời gọi thứ hai khi lời gọi đầu chưa xong bị bỏ qua (trả `undefined`). Không bắt lỗi.
 * Không dùng cho polling hay SSE.
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
 * Biến thể của `useApiAction` cho control lặp theo list: giữ key của item đang chạy (`null` khi rảnh;
 * so bằng `=== key`, không dựa truthiness). Đang chạy một item thì lời gọi cho item khác bị bỏ qua.
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
