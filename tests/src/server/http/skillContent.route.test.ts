import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'

// TC-C1..TC-C7 (test-spec.md nhóm C) — GET /api/skill-content. Bất biến an
// toàn: route MỚI này phải tự sanitize cả phần TÊN và phần SOURCE (khác agent
// hiện có, có lỗ hổng path-traversal xác nhận ngoài phạm vi sửa — design.md §6).
//
// TC-C2 (must-fix của reviewer, review.md dòng 13) đặc biệt kiểm phần *source*
// (không chỉ *name*) của nhánh fallback `repo:` trong controller.ts — bản đầu
// (review lượt 1) chỉ sanitize `name`, bỏ sót `pluginName`, cho phép
// `id=repo:../../../../etc:passwd` thoát khỏi thư mục `plugins/`.

let outerBase: string
let base: string
let root: string
let projectRoot: string
let app: Awaited<ReturnType<typeof createApp>>

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
    resolveProjectRoot: (id: string | null) => (id ? null : root),
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

beforeAll(async () => {
  // `base` nằm đúng 3 cấp dưới `outerBase` (outerBase/a/b/project) để tính
  // được CHÍNH XÁC số lượng `../` cần cho payload traversal bên dưới, không
  // phụ thuộc độ sâu thật của os.tmpdir() trên máy chạy CI.
  outerBase = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-content-http-'))
  base = path.join(outerBase, 'a', 'b', 'project')
  fs.mkdirSync(base, { recursive: true })
  root = path.join(base, '.dev-team-agent')
  fs.mkdirSync(root, { recursive: true })
  projectRoot = base

  // Skill hợp lệ, đúng vị trí quét chuẩn (source 'project').
  fs.mkdirSync(path.join(base, '.claude', 'skills', 'hello-skill'), { recursive: true })
  fs.writeFileSync(
    path.join(base, '.claude', 'skills', 'hello-skill', 'SKILL.md'),
    '# Hello Skill\n\nNOI DUNG SKILL HOP LE',
  )

  // "Secret" NGOÀI `projectRoot/plugins` — nếu nhánh fallback `repo:` không
  // sanitize `pluginName`, `id=repo:../../../../secret:passwd` sẽ đọc được
  // đúng file này (4 cấp `../` từ `<projectRoot>/plugins` lên `outerBase`).
  fs.mkdirSync(path.join(outerBase, 'secret', 'skills', 'passwd'), { recursive: true })
  fs.writeFileSync(
    path.join(outerBase, 'secret', 'skills', 'passwd', 'SKILL.md'),
    'TOP SECRET — khong duoc lo qua path traversal',
  )

  app = await createApp(fakeCtx())
})

afterAll(() => {
  fs.rmSync(outerBase, { recursive: true, force: true })
})

const get = (id?: string) =>
  app.request(id === undefined ? '/api/skill-content' : `/api/skill-content?id=${encodeURIComponent(id)}`)

describe('GET /api/skill-content', () => {
  test('TC-C1: skill hợp lệ, đúng phạm vi cho phép → 200 + nội dung khớp file gốc', async () => {
    const res = await get('project:hello-skill')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.content).toContain('NOI DUNG SKILL HOP LE')
  })

  test('TC-C2: id chứa "../" trong phần tên → không trả 200, không lộ nội dung ngoài phạm vi', async () => {
    const res = await get('project:../../../a/b/project/.dev-team-agent/config')
    expect(res.status).not.toBe(200)
  })

  test('TC-C3: id chứa đường dẫn tuyệt đối trong phần tên → không trả 200', async () => {
    const res = await get('project:/etc/passwd')
    expect(res.status).not.toBe(200)
  })

  // Case cụ thể mà reviewer bắt được (review.md, [must]): traversal ở phần
  // *source* (→ pluginName) của nhánh fallback `repo:`, không phải phần name.
  test('TC-C2 (must-fix cụ thể): repo:../../../../secret:passwd không thoát được khỏi plugins/', async () => {
    const res = await get('repo:../../../../secret:passwd')
    expect(res.status).not.toBe(200)
    const body = await res.json().catch(() => null)
    expect(body?.content).toBeUndefined()
  })

  test('TC-C5: id thiếu dấu ":" phân tách → không tìm thấy, không phải 500/crash', async () => {
    const res = await get('noColonHere')
    expect(res.status).toBe(404)
  })

  test('TC-C5: id có tên rỗng sau dấu ":" → không tìm thấy, không phải 500/crash', async () => {
    const res = await get('project:')
    expect(res.status).toBe(404)
  })

  test('TC-C6: thiếu tham số id → 400, không phải 200/500', async () => {
    const res = await get(undefined)
    expect(res.status).toBe(400)
  })

  test('TC-C7: skill hợp lệ về danh sách (source project, quét qua pattern) nhưng không có file ở vị trí quét chuẩn → không rò rỉ, không 500', async () => {
    // Skill "quét qua custom pattern" luôn gán source: 'project' (design.md §2)
    // nhưng file vật lý không nằm ở `.claude/skills/<name>/SKILL.md` chuẩn —
    // ở đây file chỉ tồn tại (nếu có) ở một vị trí pattern khác, không tạo nó
    // tại vị trí chuẩn để mô phỏng đúng khoảng trống.
    const res = await get('project:pattern-only-skill')
    expect(res.status).not.toBe(200)
    expect(res.status).not.toBe(500)
  })
})
