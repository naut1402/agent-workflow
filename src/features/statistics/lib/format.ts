/** Format số liệu thống kê cho bảng/tổng/chart — dùng ở FE (không import node:*). */

/** Đặt dấu phẩy ngăn cách hàng nghìn trong phần nguyên: 1234567.8 → "1,234,567.8". */
function groupIntegerPart(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Định dạng có đơn vị: 1234567 → "1.23M", 123456 → "123.5K", 1234 → "1,234".
 * Phần mantissa có dấu phẩy ngăn cách nghìn ("12,345.6K") để dễ đọc.
 */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return withUnit(value, 1_000_000_000, 'B')
  if (abs >= 1_000_000) return withUnit(value, 1_000_000, 'M')
  if (abs >= 10_000) return withUnit(value, 1_000, 'K')
  return groupIntegerPart(String(Math.round(value)))
}

function withUnit(value: number, divisor: number, unit: string): string {
  const scaled = value / divisor
  const fixed = scaled.toFixed(scaled >= 100 ? 1 : 2)
  const [intPart, decPart] = fixed.split('.')
  const grouped = groupIntegerPart(intPart)
  return decPart ? `${grouped}.${decPart}${unit}` : `${grouped}${unit}`
}

/** Số đầy đủ kèm dấu phẩy: 1234567 → "1,234,567". */
export function fullNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Math.round(value).toLocaleString('en-US')
}

export type NumberFormat = 'compact' | 'full'

/** Một cửa định dạng theo tuỳ chọn người dùng (K/M/B hay đầy đủ). */
export function formatNumber(value: number, format: NumberFormat): string {
  return format === 'compact' ? compactNumber(value) : fullNumber(value)
}

/**
 * Chọn hệ đơn vị cho trục/biểu đồ: chia giá trị để nhãn không dài gây chồng chữ.
 * max < 10K → giữ nguyên; ≥ 10K → K; ≥ 10M → M; ≥ 10B → B.
 */
export interface UnitScale {
  divisor: number
  /** Hậu tố đơn vị nhấn vào nhãn trục, vd " (K)". */
  axisSuffix: string
}

export function pickUnitScale(maxValue: number): UnitScale {
  const abs = Math.abs(maxValue)
  if (abs >= 10_000_000_000) return { divisor: 1_000_000_000, axisSuffix: ' (B)' }
  if (abs >= 10_000_000) return { divisor: 1_000_000, axisSuffix: ' (M)' }
  if (abs >= 10_000) return { divisor: 1_000, axisSuffix: ' (K)' }
  return { divisor: 1, axisSuffix: '' }
}

/** 3725000 → "1h 2m 5s"; bỏ đơn vị 0 ở đầu (đủ "5s" / "2m 5s"). */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const totalSec = Math.round(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** Timestamp ms → "22:15 21/08" (local) cho cột thời gian bảng. */
export function formatTs(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—'
  const d = new Date(ts)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}
