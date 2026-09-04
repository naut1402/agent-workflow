import type { Container, ContainerToken, Factory } from './types'

export type { Container, ContainerToken, Factory } from './types'

/** Tạo 1 token duy nhất cho container — `description` chỉ dùng để debug/error message. */
export function createToken<T>(description: string): ContainerToken<T> {
  return Symbol(description) as ContainerToken<T>
}

export function createContainer(): Container {
  const factories = new Map<symbol, Factory<unknown>>()
  const instances = new Map<symbol, unknown>()
  const resolving: symbol[] = []

  function register<T>(token: ContainerToken<T>, factory: Factory<T>): void {
    const key = token as symbol
    if (factories.has(key)) {
      throw new Error(`Container: token "${String(key)}" đã được đăng ký`)
    }
    factories.set(key, factory as Factory<unknown>)
  }

  function resolve<T>(token: ContainerToken<T>): T {
    const key = token as symbol
    if (instances.has(key)) return instances.get(key) as T

    const factory = factories.get(key)
    if (!factory) {
      throw new Error(`Container: chưa đăng ký provider cho token "${String(key)}"`)
    }
    if (resolving.includes(key)) {
      const chain = [...resolving, key].map((t) => String(t)).join(' → ')
      throw new Error(`Container: circular dependency (${chain})`)
    }

    resolving.push(key)
    try {
      const instance = factory(container) as T
      instances.set(key, instance)
      return instance
    } finally {
      resolving.pop()
    }
  }

  const container: Container = { register, resolve }
  return container
}
