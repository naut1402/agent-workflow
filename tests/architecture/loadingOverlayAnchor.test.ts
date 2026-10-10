import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Bất biến CSS của `CLoadingOverlay` — finding F1.
 *
 * Overlay là `position: absolute; inset: 0`, nên nó neo vào **containing block**
 * gần nhất. Nếu containing block đó lại là chính hộp CUỘN thì `inset: 0` lấy cỡ
 * bằng padding box nhưng neo vào gốc NỘI DUNG: cuộn xuống là overlay trôi ra
 * khỏi vùng nhìn thấy và để hở toàn bộ form. Bản sửa tách chỗ neo thành lớp bọc
 * `.c-loading-host` nằm NGOÀI hộp cuộn.
 *
 * 🚫 jsdom không thấy được chuyện này (không có layout, không resolve CSS), còn
 * E2E chỉ chạy một dialog đại diện. Đây là lưới phủ được cả 11 điểm đặt bằng
 * một phép kiểm tĩnh — rẻ, và chạy ở mọi lượt CI.
 */

const ROOT = path.resolve(import.meta.dir, '../..')
const SRC = path.join(ROOT, 'src')

/** Hộp CUỘN. Lớp nào trong đây mà thành containing block là tái tạo lại F1. */
const SCROLLER_CLASSES = ['modal-body', 'qa-form-body', 'knowledge-collection-body', 'automation-form-body']
const POSITIONED = /position\s*:\s*(relative|absolute|sticky|fixed)/

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(scss|css|vue)$/.test(e.name)) out.push(p)
  }
  return out
}

/**
 * Bóc các khối `selector { … }` ở mức đơn giản (không lồng). Đủ cho câu hỏi ở
 * đây: khối nào nhắm tới một lớp hộp cuộn và khai `position`.
 */
function ruleBlocks(text: string): Array<{ selector: string; body: string }> {
  const blocks: Array<{ selector: string; body: string }> = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    blocks.push({ selector: m[1].trim().split('\n').pop()!.trim(), body: m[2] })
  }
  return blocks
}

const FILES = walk(SRC)

describe('CLoadingOverlay — chỗ neo phải nằm ngoài hộp cuộn (F1)', () => {
  test('không hộp cuộn nào được là containing block', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      const text = fs.readFileSync(file, 'utf8')
      if (!SCROLLER_CLASSES.some((c) => text.includes(c))) continue
      for (const { selector, body } of ruleBlocks(text)) {
        const hitsScroller = SCROLLER_CLASSES.some((c) => selector.includes(`.${c}`))
        if (hitsScroller && POSITIONED.test(body)) {
          offenders.push(`${path.relative(ROOT, file)} → ${selector}`)
        }
      }
    }
    expect(offenders, 'hộp cuộn thành containing block ⇒ overlay trôi khi cuộn').toEqual([])
  })

  test('`.c-loading-host` khai `position: relative` ở tầng dùng chung', () => {
    const shell = fs.readFileSync(path.join(SRC, 'frontend/styles/_shell.scss'), 'utf8')
    const host = ruleBlocks(shell).find((b) => b.selector === '.c-loading-host')
    expect(host, '`.c-loading-host` phải khai ở `_shell.scss` — nó là bất biến xuyên feature').toBeDefined()
    expect(host!.body).toMatch(/position\s*:\s*relative/)
  })

  test('mọi `<CLoadingOverlay>` cạnh hộp cuộn đều nằm trong `.c-loading-host`', () => {
    const offenders: string[] = []
    for (const file of FILES.filter((f) => f.endsWith('.vue'))) {
      const text = fs.readFileSync(file, 'utf8')
      if (!text.includes('<CLoadingOverlay')) continue
      if (!SCROLLER_CLASSES.some((c) => text.includes(`"${c}`) || text.includes(` ${c}"`))) continue
      if (!text.includes('c-loading-host')) offenders.push(path.relative(ROOT, file))
    }
    expect(offenders, 'vùng có nội dung tự cuộn phải bọc `.c-loading-host`').toEqual([])
  })
})
