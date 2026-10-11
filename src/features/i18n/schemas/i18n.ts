import { z } from 'zod'

export const LocaleParam = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/)

export const LocaleManifest = z.object({
  locales: z.array(z.string()),
  defaultLocale: z.string(),
})

export type LocaleManifest = z.infer<typeof LocaleManifest>
