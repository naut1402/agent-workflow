/**
 * Base cho tầng business (domain) của từng feature — không biết HTTP.
 * FE không import module này.
 *
 * Kết quả lỗi dùng shape `{ status, error }` (controller check `'error' in r`)
 * để khớp convention sẵn có trong domain modules.
 */
export type BusinessError = {
  status: number
  error: string
}

export abstract class AbstractBusiness {
  constructor(protected readonly root: string | null = null) {}

  /** Root project (`.dev-team-agent/`) nếu có. */
  protected getRoot(): string | null {
    return this.root
  }

  /**
   * Root bắt buộc. Narrow bằng `'error' in gate` (tránh boolean discriminant
   * dưới vue-tsc / TS quirk của repo).
   */
  protected requireRoot(): { root: string } | BusinessError {
    if (!this.root) return { status: 404, error: 'unknown project' }
    return { root: this.root }
  }

  protected fail(status: number, error: string): BusinessError {
    return { status, error }
  }

  protected badRequest(error: string): BusinessError {
    return this.fail(400, error)
  }

  protected notFound(error: string): BusinessError {
    return this.fail(404, error)
  }
}
