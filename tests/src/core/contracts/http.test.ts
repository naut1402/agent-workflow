import { describe, expect, it } from 'vitest'
import type { ServerResponse } from 'node:http'
import { json } from '@shared/http'

function mockRes() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(k: string, v: string) {
      this.headers[k] = v
    },
    end(payload: string) {
      this.body = payload
    },
  }
}

describe('json', () => {
  it('writes status, JSON body and no-store headers', () => {
    const res = mockRes()
    json(res as unknown as ServerResponse, 201, { ok: true, n: 1 })
    expect(res.statusCode).toBe(201)
    expect(res.headers['Content-Type']).toBe('application/json; charset=utf-8')
    expect(res.headers['Cache-Control']).toBe('no-store')
    expect(JSON.parse(res.body)).toEqual({ ok: true, n: 1 })
  })

  it('serialises arrays', () => {
    const res = mockRes()
    json(res as unknown as ServerResponse, 200, [1, 2, 3])
    expect(res.body).toBe('[1,2,3]')
  })
})
