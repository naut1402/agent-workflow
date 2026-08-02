/** Generic string helpers (slug, …). */

export type SlugifyOptions = {
  maxLength?: number
  fallback?: string
}

/** Lowercase ASCII slug; strips diacritics. */
export function slugify(text: string, opts: SlugifyOptions = {}): string {
  const maxLength = opts.maxLength ?? 48
  const fallback = opts.fallback ?? 'item'
  const base = (text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // đ/Đ không tách được bằng NFD — map tay trước khi strip non-ascii.
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
  return base || fallback
}

/** Section/step key slug (agent markdown). */
export function slugifySectionKey(title: string): string {
  return slugify(title || 'section', { maxLength: 32, fallback: 'section' })
}
