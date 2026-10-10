import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { defineDto, type Dto, type DtoInput } from '../../../../src/shared/type/dto'

describe('src/shared/type/dto', () => {
  const Schema = defineDto(z.object({ name: z.string(), limit: z.coerce.number().default(10) }))

  test('defineDto trả lại đúng schema (identity) — safeParse dùng như schema gốc', () => {
    expect(Schema.safeParse({ name: 'a' })).toEqual({ success: true, data: { name: 'a', limit: 10 } })
    expect(Schema.safeParse({}).success).toBe(false)
  })

  test('Dto = đầu ra sau default/coerce; DtoInput = đầu vào (kiểm bởi vue-tsc)', () => {
    const out: Dto<typeof Schema> = { name: 'a', limit: 1 }
    // @ts-expect-error — name phải là string
    const wrong: Dto<typeof Schema> = { name: 1, limit: 1 }
    const input: DtoInput<typeof Schema> = { name: 'a' }
    expect([out, wrong, input]).toHaveLength(3)
  })
})
