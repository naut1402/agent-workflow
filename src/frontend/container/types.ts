/** Token định danh 1 service trong container — dựa trên `Symbol` để đảm bảo duy nhất. */
export type ContainerToken<T> = symbol & { readonly __type?: T }

export type Factory<T> = (container: Container) => T

export interface Container {
  /** Đăng ký factory cho 1 token. Throw nếu token đã được đăng ký. */
  register<T>(token: ContainerToken<T>, factory: Factory<T>): void
  /** Resolve service — lazy, cache singleton sau lần resolve đầu tiên. */
  resolve<T>(token: ContainerToken<T>): T
}
