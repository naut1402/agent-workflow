/** Lỗi của tầng business (domain, không biết HTTP); controller narrow bằng `'error' in r`. */
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

  /** Root bắt buộc; narrow kết quả bằng `'error' in gate`. */
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
