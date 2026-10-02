import { z } from 'zod'

/**
 * Mã locale ở path param. Lớp chặn thứ nhất của G-C4 (traversal) — lớp thứ hai là
 * `resolvePathUnder` trong business. Sanitize nằm ở feature sở hữu, không đẩy lên core.
 */
export const LocaleParam = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/)

export const LocaleManifest = z.object({
  locales: z.array(z.string()),
  defaultLocale: z.string(),
})

export type LocaleManifest = z.infer<typeof LocaleManifest>
