// Tcebe274e-P3 · `isPrivateHostname` dời từ `agent-editor/business/agents.ts` về
// `src/backend/lib/netUtils.ts`. Ba feature dùng chung (`fetchUrlSafe`,
// `sanitiseGitUrl`, guard endpoint MCP) — logic giữ nguyên từng dòng, nên bộ ca
// dưới đây là bộ ca cũ của `sanitize.test.ts` cộng các biên của từng dải.
import { describe, expect, it } from 'vitest'
import { isPrivateHostname } from '@/backend/lib/netUtils'

describe('isPrivateHostname', () => {
  it.each(['localhost', 'foo.local', '127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.0.1', '172.31.255.255'])(
    'treats %s as private',
    (h) => expect(isPrivateHostname(h)).toBe(true),
  )

  it.each(['example.com', '8.8.8.8', '172.32.0.1', '11.0.0.1'])(
    'treats %s as public',
    (h) => expect(isPrivateHostname(h)).toBe(false),
  )

  it('biên dải 172.16/12 — 172.15 và 172.32 nằm ngoài', () => {
    expect(isPrivateHostname('172.15.255.255')).toBe(false)
    expect(isPrivateHostname('172.20.0.1')).toBe(true)
    expect(isPrivateHostname('172.32.0.0')).toBe(false)
  })

  it('so không phân biệt hoa thường — hostname người dùng gõ có thể viết hoa', () => {
    expect(isPrivateHostname('LOCALHOST')).toBe(true)
    expect(isPrivateHostname('Printer.LOCAL')).toBe(true)
  })

  it('chuỗi rỗng / giá trị rỗng không bị coi là private và 🚫 không ném', () => {
    expect(isPrivateHostname('')).toBe(false)
    expect(isPrivateHostname(undefined as unknown as string)).toBe(false)
  })

  it('chỉ khớp tiền tố dải, không khớp chuỗi con ở giữa', () => {
    expect(isPrivateHostname('8.10.0.1')).toBe(false)
    expect(isPrivateHostname('1.192.168.1')).toBe(false)
    expect(isPrivateHostname('notlocalhost.com')).toBe(false)
  })
})
