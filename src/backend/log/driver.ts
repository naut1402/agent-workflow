import type { LogEntry, LogType } from '../../shared/log/schema.js'

/** Điều kiện đọc log — dùng chung cho mọi driver. */
export type LogQuery = {
  /** Một type, hoặc nhiều type — nhiều type thì gộp, sort newest-first chung rồi mới cắt `limit`. */
  type: LogType | readonly LogType[]
  /** Chỉ entry của project này; `null` / bỏ trống = mọi project. */
  project?: string | null
  /** Số entry tối đa; `null` / bỏ trống = không giới hạn. */
  limit?: number | null
}

/**
 * Kho log: ghi (`append`) và đọc (`query`) của cùng một kho đi cặp trong một hiện thực.
 * Hợp đồng thuần — chỗ chọn hiện thực là `driverInit.ts`.
 */
export type LogDriver = {
  append(entry: LogEntry): Promise<void>
  /**
   * Đọc entry newest-first. Kho thiếu → `[]`; bản ghi hỏng bị bỏ qua.
   * Không lọc type đang tắt — việc đó nằm ở `queryLogs` (`store.ts`).
   */
  query(q: LogQuery): Promise<LogEntry[]>
  /**
   * Tuỳ chọn: chữ ký trạng thái kho của `type`, đổi mỗi khi kho của type đó đổi —
   * để nơi đọc cache kết quả. Driver không có hook → nơi đọc không cache.
   */
  revision?(type: LogType): Promise<string | null>
}

/** Danh sách type của một `LogQuery` (chuẩn hoá một type → mảng). */
export function logQueryTypes(q: LogQuery): readonly LogType[] {
  return typeof q.type === 'string' ? [q.type] : q.type
}
