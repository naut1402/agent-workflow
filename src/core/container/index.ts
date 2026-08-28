import type { Container, ContainerToken, Factory } from './types'

export type { Container, ContainerToken, Factory } from './types'

/** Tạo 1 token duy nhất cho container — `description` chỉ dùng để debug/error message. */
export function createToken<T>(description: string): ContainerToken<T> {
  return Symbol(description) as ContainerToken<T>
}

/**
 * Container 2 tầng: gọi không tham số → container độc lập (FE `main.ts`, root
 * container của BE); truyền `parent` → **child scope** kế thừa token của cha.
 *
 * Bất biến: child **không** cache instance của parent — parent tự cache, nên
 * service process-scoped chỉ có đúng 1 bản dù N child scope cùng resolve.
 */
export function createContainer(parent?: Container): Container {
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
      // Child scope đè được token của cha; token không đè thì lấy instance
      // singleton ở tầng đã đăng ký (parent tự cache).
      if (parent) return parent.resolve(token)
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

  function has(token: ContainerToken<unknown>): boolean {
    return factories.has(token as symbol) || (parent ? parent.has(token) : false)
  }

  const container: Container = { register, resolve, has }
  return container
}
