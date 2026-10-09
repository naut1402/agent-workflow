/**
 * Parse JSON của file dữ liệu người sửa được; ném lỗi (tiền tố `describe`) khi không
 * parse được hoặc không phải object.
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
