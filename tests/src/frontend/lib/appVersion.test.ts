import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_VERSION } from '../../../../src/frontend/lib/appVersion'
import { APP_VERSION as BACKEND_APP_VERSION } from '@/backend/configs/appVersion'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

describe('APP_VERSION', () => {
  it('matches package.json version (injected via vitest define)', () => {
    expect(APP_VERSION).toBe(pkg.version)
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  /**
   * TC-G10 (Tdad47b2b) — version phát hành của task.
   *
   * Hai đường lấy dữ liệu khác nhau (`__APP_VERSION__` do Vite bơm ↔ `import`
   * thẳng `package.json`) nên đây là chỗ duy nhất chấm được rằng chúng vẫn dẫn
   * xuất từ MỘT nguồn. Con số được viết tường minh vì nó chính là acceptance
   * criterion, 🚫 không phải hằng nội bộ.
   */
  it('TC-G10: backend và giao diện cùng báo 1.2.0, cùng dẫn xuất từ package.json', () => {
    expect(pkg.version).toBe('1.2.0')
    expect(APP_VERSION).toBe('1.2.0')
    expect(BACKEND_APP_VERSION).toBe('1.2.0')
    expect(BACKEND_APP_VERSION).toBe(APP_VERSION)
  })
})
