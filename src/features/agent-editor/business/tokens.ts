import { createToken, type ContainerToken } from '../../../core/container/index.js'
import type { AgentEditorBusiness } from './AgentEditorBusiness.js'

/**
 * Surface hẹp mà controller của feature + peer feature được phép dùng.
 * Dẫn xuất bằng `Pick` (danh sách method khai tường minh) nên vừa narrow vừa
 * không lệch chữ ký so với class.
 *
 * File này phải **FE-safe**: chỉ import giá trị từ `core/container`; mọi import
 * khác là `import type` (bị xoá lúc compile) để Vite không kéo `node:*` vào bundle.
 */
export type AgentEditorPort = Pick<
  AgentEditorBusiness,
  'listMeta' | 'readAgent' | 'agentsDir' | 'templatesDir' | 'workflowTemplatesDir'
>

export const agentEditorBusinessToken: ContainerToken<AgentEditorPort> =
  createToken<AgentEditorPort>('agentEditorBusiness')
