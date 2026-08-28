/** Token định danh 1 service trong container — dựa trên `Symbol` để đảm bảo duy nhất. */
export type ContainerToken<T> = symbol & { readonly __type?: T }

export type Factory<T> = (container: Container) => T

export interface Container {
  /** Đăng ký factory cho 1 token. Throw nếu token đã được đăng ký **ở chính container này**. */
  register<T>(token: ContainerToken<T>, factory: Factory<T>): void
  /**
   * Resolve service — lazy, cache singleton sau lần resolve đầu tiên.
   * Token không có ở container này thì fallback lên `parent` (nếu có);
   * instance luôn nằm ở **container đăng ký factory**, không copy xuống child.
   */
  resolve<T>(token: ContainerToken<T>): T
  /** Token đã đăng ký ở container này hoặc bất kỳ tầng `parent` nào? */
  has(token: ContainerToken<unknown>): boolean
}
