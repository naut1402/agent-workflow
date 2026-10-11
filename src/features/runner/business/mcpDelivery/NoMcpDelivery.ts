import { McpJobDelivery } from './McpJobDelivery.js'

/** Provider không nhận MCP (Null Object) — `prepare` trả `null` ngay, không cảnh báo. */
export class NoMcpDelivery extends McpJobDelivery<null> {
  readonly kind = 'unsupported' as const

  override async prepare(): Promise<null> {
    return null
  }

  protected attach(): null {
    return null
  }
}
