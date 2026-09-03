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

describe('container — child scope (2 tầng)', () => {
  it('child kế thừa token của parent', () => {
    const token = createToken<{ v: string }>('inherited')
    const parent = createContainer()
    parent.register(token, () => ({ v: 'from-parent' }))
    const child = createContainer(parent)

    expect(child.resolve(token)).toBe(parent.resolve(token))
  })

  it('instance ở parent là singleton dùng chung cho mọi child', () => {
    const token = createToken<{ id: number }>('process-scoped')
    const factory = vi.fn(() => ({ id: 1 }))
    const parent = createContainer()
    parent.register(token, factory)

    const c1 = createContainer(parent)
    const c2 = createContainer(parent)

    expect(c1.resolve(token)).toBe(c2.resolve(token))
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('child đè token của parent — parent và child khác không bị ảnh hưởng', () => {
    const token = createToken<string>('overridable')
    const parent = createContainer()
    parent.register(token, () => 'parent')

    const overriding = createContainer(parent)
    overriding.register(token, () => 'child')
    const plain = createContainer(parent)

    expect(overriding.resolve(token)).toBe('child')
    expect(parent.resolve(token)).toBe('parent')
    expect(plain.resolve(token)).toBe('parent')
  })

  it('token riêng của child không rò sang child khác — throw như container không cha', () => {
    const token = createToken<string>('child-only')
    const parent = createContainer()
    const c1 = createContainer(parent)
    const c2 = createContainer(parent)
    c1.register(token, () => 'c1')

    expect(c1.resolve(token)).toBe('c1')
    expect(() => c2.resolve(token)).toThrow(/chưa đăng ký provider cho token/)
    expect(() => c2.resolve(token)).toThrow(/child-only/)
  })

  it('token không có ở cả 2 tầng — message lỗi giống container không cha', () => {
    const token = createToken<string>('nowhere')
    const standalone = createContainer()
    const child = createContainer(createContainer())

    let standaloneMsg = ''
    let childMsg = ''
    try {
      standalone.resolve(token)
    } catch (err) {
      standaloneMsg = (err as Error).message
    }
    try {
      child.resolve(token)
    } catch (err) {
      childMsg = (err as Error).message
    }

    expect(standaloneMsg).toBeTruthy()
    expect(childMsg).toBe(standaloneMsg)
  })

  it('chuỗi kế thừa nhiều tầng — resolve lên tới tầng đăng ký', () => {
    const token = createToken<string>('deep')
    const a = createContainer()
    a.register(token, () => 'from-a')
    const b = createContainer(a)
    const c = createContainer(b)

    expect(c.resolve(token)).toBe('from-a')
  })

  it('2 token cùng description vẫn là 2 định danh độc lập', () => {
    const t1 = createToken<string>('same-name')
    const t2 = createToken<string>('same-name')
    const container = createContainer()
    container.register(t1, () => 'one')
    container.register(t2, () => 'two')

    expect(container.resolve(t1)).toBe('one')
    expect(container.resolve(t2)).toBe('two')
  })

  it('has() nhìn cả tầng cha, false khi không tầng nào đăng ký', () => {
    const parentToken = createToken<string>('has-parent')
    const childToken = createToken<string>('has-child')
    const missing = createToken<string>('has-missing')
    const parent = createContainer()
    parent.register(parentToken, () => 'p')
    const child = createContainer(parent)
    child.register(childToken, () => 'c')

    expect(child.has(parentToken)).toBe(true)
    expect(child.has(childToken)).toBe(true)
    expect(child.has(missing)).toBe(false)
    expect(parent.has(childToken)).toBe(false)
  })

  it('peer resolve LƯỜI (trong method) không bị coi là circular', () => {
    // Bất biến của business layer: factory KHÔNG resolve peer; peer chỉ được
    // resolve trong method — lúc đó factory đã pop khỏi stack `resolving`.
    type Peer = { ping(): string }
    const tokenA = createToken<Peer>('peerA')
    const tokenB = createToken<Peer>('peerB')
    const container = createContainer()

    container.register(tokenA, (c) => ({ ping: () => `A→${c.resolve(tokenB).ping()}` }))
    container.register(tokenB, (c) => ({ ping: () => (c.has(tokenA) ? 'B' : 'B?') }))

    expect(container.resolve(tokenA).ping()).toBe('A→B')
  })
})
