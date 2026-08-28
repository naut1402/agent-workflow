import { describe, expect, test } from 'bun:test'
import { buildRootContainer, createRequestScope } from '../../../../src/api/businessContainer.js'
import { requestScopeToken } from '../../../../src/core/container/requestScope.js'
import { createToken, type ContainerToken } from '../../../../src/core/container/index.js'
import type { RegistryContext } from '../../../../src/core/http/types.js'
import { agentEditorBusinessToken } from '../../../../src/features/agent-editor/business/tokens.js'
import { knowledgeBusinessToken } from '../../../../src/features/knowledge/business/tokens.js'
import { logsBusinessToken } from '../../../../src/features/logs/business/tokens.js'
import { monitorBusinessToken } from '../../../../src/features/monitor/business/tokens.js'
import { nlChatBusinessToken } from '../../../../src/features/nl-chat/business/tokens.js'
import { pipelineEditorBusinessToken } from '../../../../src/features/pipeline-editor/business/tokens.js'
import { runnerBusinessToken } from '../../../../src/features/runner/business/tokens.js'
import { settingsBusinessToken } from '../../../../src/features/settings/business/tokens.js'
import { statisticsBusinessToken } from '../../../../src/features/statistics/business/tokens.js'

// Auto-scan wiring của business container: mọi features/<name>/registerBusiness.ts
// phải nạp được và đăng ký đúng token — không liệt kê feature bằng tay ở prod code,
// nên test là chỗ duy nhất chốt danh sách 9 facade.

const BUSINESS_TOKENS: ReadonlyArray<readonly [string, ContainerToken<unknown>]> = [
  ['agent-editor', agentEditorBusinessToken],
  ['knowledge', knowledgeBusinessToken],
  ['logs', logsBusinessToken],
  ['monitor', monitorBusinessToken],
  ['nl-chat', nlChatBusinessToken],
  ['pipeline-editor', pipelineEditorBusinessToken],
  ['runner', runnerBusinessToken],
  ['settings', settingsBusinessToken],
  ['statistics', statisticsBusinessToken],
]

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: '/tmp/dtd-container-root',
    resolveProjectRoot: (id: string | null) => (id === 'unknown' ? null : `/tmp/dtd-${id ?? 'default'}`),
    registry: {
      list: () => ({ projects: [], defaultId: null }),
      get: () => null,
      add: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      remove: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      validateProjectPath: (() => ({ ok: false, status: 400, error: 'stub' })) as any,
      seedDefault: () => null,
    },
  }
}

function scopeFor(projectId: string | null, ctx = fakeCtx()) {
  return { root: ctx.resolveProjectRoot(projectId), projectId, ctx }
}

describe('buildRootContainer', () => {
  test('nạp được mọi registerBusiness.ts và giữ danh sách module', async () => {
    const root = await buildRootContainer()
    const child = createRequestScope(root, scopeFor('p1'))

    for (const [feature, token] of BUSINESS_TOKENS) {
      expect(child.has(token), `${feature}: token phải đăng ký được`).toBe(true)
      expect(child.resolve(token)).toBeDefined()
    }
  })

  test('gọi nhiều lần không throw duplicate token — mỗi app instance 1 root riêng', async () => {
    const first = await buildRootContainer()
    const second = await buildRootContainer()

    expect(first).not.toBe(second)
    const c1 = createRequestScope(first, scopeFor('p1'))
    const c2 = createRequestScope(second, scopeFor('p1'))
    expect(c1.resolve(monitorBusinessToken)).not.toBe(c2.resolve(monitorBusinessToken))
  })
})

describe('createRequestScope', () => {
  test('facade lấy root theo request — 2 scope khác project không dùng chung instance', async () => {
    const root = await buildRootContainer()
    const s1 = createRequestScope(root, scopeFor('p1'))
    const s2 = createRequestScope(root, scopeFor('p2'))

    expect(s1.resolve(requestScopeToken).root).toBe('/tmp/dtd-p1')
    expect(s2.resolve(requestScopeToken).root).toBe('/tmp/dtd-p2')
    expect(s1.resolve(monitorBusinessToken)).not.toBe(s2.resolve(monitorBusinessToken))
  })

  test('root null (project không resolve được) vẫn tạo scope, không throw', async () => {
    const root = await buildRootContainer()
    const scope = createRequestScope(root, scopeFor('unknown'))

    expect(scope.resolve(requestScopeToken).root).toBe(null)
    expect(() => scope.resolve(monitorBusinessToken)).not.toThrow()
  })

  test('service process-scoped ở root là singleton dùng chung cho mọi request', async () => {
    const root = await buildRootContainer()
    const token = createToken<{ id: number }>('process-scoped-probe')
    let created = 0
    root.register(token, () => ({ id: ++created }))

    const a = createRequestScope(root, scopeFor('p1')).resolve(token)
    const b = createRequestScope(root, scopeFor('p2')).resolve(token)

    expect(a).toBe(b)
    expect(created).toBe(1)
  })

  test('test override được facade bằng cách đăng ký token ở child scope', async () => {
    const root = await buildRootContainer()
    const scope = createRequestScope(root, scopeFor('p1'))
    const stub = { usageStats: () => ({ stubbed: true }) } as any

    // register throw khi trùng ở CÙNG container, nên stub phải đi qua scope mới.
    const overriding = createRequestScope(root, scopeFor('p1'))
    expect(() => overriding.register(statisticsBusinessToken, () => stub)).toThrow()

    // Seam thực tế: child của child — tầng ngoài cùng đè, tầng trong giữ nguyên.
    const { createContainer } = await import('../../../../src/core/container/index.js')
    const testScope = createContainer(scope)
    testScope.register(statisticsBusinessToken, () => stub)

    expect(testScope.resolve(statisticsBusinessToken)).toBe(stub)
    expect(scope.resolve(statisticsBusinessToken)).not.toBe(stub)
  })

  test('requestScopeToken không tồn tại ở root container', async () => {
    const root = await buildRootContainer()
    expect(root.has(requestScopeToken)).toBe(false)
    expect(() => root.resolve(requestScopeToken)).toThrow(/chưa đăng ký provider cho token/)
  })
})

describe('business/tokens.ts giữ FE-safe', () => {
  // Bất biến: token file có thể bị Vite kéo vào bundle FE qua một nhánh import
  // nào đó — nếu nó import runtime một module chạm `node:*` thì build FE nổ.
  // Cho phép duy nhất 1 runtime import: `core/container` (thuần, không node:*).
  test('mọi import runtime khác core/container đều là `import type`', async () => {
    const { readTextFile, joinPath } = await import('../../../../src/core/lib/fileHelper.js')
    const featuresDir = joinPath(import.meta.dir, '../../../../src/features')

    for (const [feature] of BUSINESS_TOKENS) {
      const src = await readTextFile(joinPath(featuresDir, feature, 'business/tokens.ts'))
      const runtimeImports = [...src.matchAll(/^import\s+(?!type\s)(.+?)\s+from\s+'([^']+)'/gm)].map(
        (m) => m[2],
      )
      expect(runtimeImports, `${feature}/business/tokens.ts`).toEqual([
        '../../../core/container/index.js',
      ])
      expect(src, `${feature}/business/tokens.ts`).not.toMatch(/from\s+'node:/)
    }
  })
})
