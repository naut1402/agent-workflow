/** Coerce unknown to array (API/YAML defensive reads). */
export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}
