/**
 * Đọc JSON của file dữ liệu mà **người sửa được** — ba cổng (`coverage-gate.ts` ·
 * `test-anchor.ts` · `test-coverage-status.ts`) đều cần đúng một hành vi: parse
 * được **và** là object, sai thì throw kèm tên file.
 *
 * Vì sao tách thành một chỗ: fallback im lặng ở đây chính là cách âm thầm tắt
 * cổng, nên cả ba phải throw **cùng một kiểu**. Ba bản copy thì chỉ cần một bản
 * bị nới là hở, mà chỗ hở đó không có gì nhắc.
 *
 * `describe` là tiền tố thông điệp (`"Baseline reports/x.json"`), không chỉ tên
 * file: mỗi cổng có cách gọi dữ liệu của nó và thông điệp phải đọc được ngay.
 */
export function parseJsonObject(raw: string, describe: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`${describe} không phải JSON hợp lệ: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${describe} phải là object JSON.`)
  }
  return parsed as Record<string, unknown>
}
