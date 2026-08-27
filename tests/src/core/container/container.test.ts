import { describe, expect, it, vi } from 'vitest'
import { createContainer, createToken } from '@/core/container'

describe('container', () => {
  it('register + resolve trả đúng instance từ factory', () => {
    const token = createToken<{ value: number }>('service')
    const container = createContainer()
    container.register(token, () => ({ value: 42 }))
    expect(container.resolve(token)).toEqual({ value: 42 })
  })

  it('resolve cache singleton — factory chỉ chạy 1 lần dù resolve nhiều lần', () => {
    const token = createToken<{ id: number }>('singleton')
    const factory = vi.fn(() => ({ id: Math.random() }))
    const container = createContainer()
    container.register(token, factory)

    const first = container.resolve(token)
    const second = container.resolve(token)

    expect(first).toBe(second)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('resolve() throw rõ tên token khi chưa đăng ký', () => {
    const token = createToken<string>('missing')
    const container = createContainer()
    expect(() => container.resolve(token)).toThrow(/missing/)
  })

  it('register() throw khi đăng ký trùng token', () => {
    const token = createToken<string>('dup')
    const container = createContainer()
    container.register(token, () => 'a')
    expect(() => container.register(token, () => 'b')).toThrow(/dup/)
  })

  it('resolve() throw lỗi circular dependency thay vì stack overflow', () => {
    const tokenA = createToken<unknown>('A')
    const tokenB = createToken<unknown>('B')
    const container = createContainer()

    container.register(tokenA, (c) => c.resolve(tokenB))
    container.register(tokenB, (c) => c.resolve(tokenA))

    expect(() => container.resolve(tokenA)).toThrow(/circular dependency/)
  })

  it('resolve() lazy — factory không chạy cho tới khi được resolve', () => {
    const token = createToken<number>('lazy')
    const factory = vi.fn(() => 1)
    const container = createContainer()
    container.register(token, factory)

    expect(factory).not.toHaveBeenCalled()
    container.resolve(token)
    expect(factory).toHaveBeenCalledTimes(1)
  })
})
