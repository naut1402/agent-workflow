import { createContainer, createToken, type Container, type ContainerToken } from '../core/container/index.js'
import { requestScopeToken, type RequestScope } from '../core/container/requestScope.js'
import { dirnameFromImportMeta, resolvePath } from '../core/lib/fileHelper.js'
import { loadModulesUnder } from '../core/lib/dirModuleLoader.js'

// ── Business container (IoC/DI cho backend) ─────────────────────────────────
//
// 2 tầng vòng đời, vì business layer trộn 2 loại state:
//   • root container  — 1 / `createApp()`, giữ service process-scoped (job
//     queue, provider registry, OAuth pending, mutex ghi state).
//   • child scope     — 1 / request, giữ facade `XxxBusiness` gate theo `root`
//     đã resolve từ `?project=`; token không có ở child thì fallback lên root.
//
// Đặt ở `src/api/` (tầng setup) vì `core` không được import `features`
// (feature-organization-rule.md §4). Cùng cơ chế auto-scan như
// `registerFeatureRoutes`: mỗi `features/<name>/registerBusiness.ts` tự khai,
// không liệt kê feature bằng tay.

export type FeatureBusinessModule = {
  /** Service sống suốt đời process — đăng ký 1 lần vào root container. */
  registerBusiness?: (c: Container) => void
  /** Facade phụ thuộc `root` của request — đăng ký lại ở mỗi child scope. */
  registerRequestScoped?: (c: Container) => void
}

const featuresRoot = resolvePath(dirnameFromImportMeta(import.meta.url), '../features')

/**
 * Danh sách module `registerBusiness.ts` được cất **trong chính root container**
 * (không phải biến module-level) để `createRequestScope` không phụ thuộc state
 * ẩn và để 2 `createApp()` trong cùng process hoàn toàn độc lập.
 */
const businessModulesToken: ContainerToken<FeatureBusinessModule[]> =
  createToken<FeatureBusinessModule[]>('businessModules')

/** Cache **module** (không phải instance) — dynamic import chỉ tốn 1 lần / process. */
let modulesPromise: Promise<FeatureBusinessModule[]> | null = null

function loadBusinessModules(): Promise<FeatureBusinessModule[]> {
  if (!modulesPromise) {
    // Reset khi lỗi để một lần import hỏng không ghim mọi createApp sau đó.
    modulesPromise = loadModulesUnder<FeatureBusinessModule>(featuresRoot, {
      entryFile: 'registerBusiness.ts',
    }).catch((err) => {
      modulesPromise = null
      throw err
    })
  }
  return modulesPromise
}

/**
 * Root container của 1 app instance. Gọi nhiều lần trả về container **mới** mỗi
 * lần (test dùng `createApp` nhiều lần — không được throw duplicate token).
 */
export async function buildRootContainer(): Promise<Container> {
  const mods = await loadBusinessModules()
  const root = createContainer()
  root.register(businessModulesToken, () => mods)
  for (const mod of mods) mod.registerBusiness?.(root)
  return root
}

/**
 * Child scope cho 1 request. `root` null (project không resolve được) vẫn tạo
 * scope bình thường — facade tự trả 404 `unknown project` qua `requireRoot()`;
 * throw ở đây sẽ biến 404 thành 500.
 */
export function createRequestScope(root: Container, scope: RequestScope): Container {
  const child = createContainer(root)
  child.register(requestScopeToken, () => scope)
  for (const mod of root.resolve(businessModulesToken)) mod.registerRequestScoped?.(child)
  return child
}
