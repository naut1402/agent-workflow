import { describe, expect, it } from 'vitest'
import {
  joinMarkdownSections,
  shallowestHeadingLevel,
  splitByHeadingLevel,
  splitMarkdownSections,
} from '@/frontend/lib/markdownSections'
import * as inlineEdit from '@/features/monitor/composables/useInlineMarkdownEdit'

describe('splitMarkdownSections', () => {
  it('cắt theo heading cấp 2 và giữ nguyên dấu ## ở đầu mỗi phần', () => {
    expect(splitMarkdownSections('## A\n\na\n\n## B\n\nb')).toEqual([
      '## A\n\na\n\n',
      '## B\n\nb',
    ])
  })

  it('giữ phần trước heading đầu tiên làm một section riêng', () => {
    const parts = splitMarkdownSections('mở đầu\n\n## A\n\na')
    expect(parts).toHaveLength(2)
    expect(parts[0]).toContain('mở đầu')
  })

  it('chuỗi trắng trả mảng rỗng', () => {
    expect(splitMarkdownSections('')).toEqual([])
    expect(splitMarkdownSections('   \n  ')).toEqual([])
  })

  it('### không phải mốc cắt, chỉ ## mới là', () => {
    expect(splitMarkdownSections('## A\n\n### A1\n\nx')).toHaveLength(1)
  })
})

describe('joinMarkdownSections', () => {
  it('ghép lại bằng một dòng trắng và bỏ phần rỗng', () => {
    expect(joinMarkdownSections(['## A', '', '## B'])).toBe('## A\n\n## B')
  })

  it('round-trip giữ đủ nội dung', () => {
    const src = '## A\n\na\n\n## B\n\nb'
    const out = joinMarkdownSections(splitMarkdownSections(src))
    for (const line of ['## A', '## B', 'a', 'b']) expect(out).toContain(line)
  })
})

// F6/F7: hàm đã chuyển sang frontend/lib, monitor chỉ re-export. Hợp đồng import
// cũ phải còn nguyên — đây là bằng chứng không phá consumer nào.
describe('re-export qua useInlineMarkdownEdit', () => {
  it('trỏ về đúng cùng một hàm', () => {
    expect(inlineEdit.splitMarkdownSections).toBe(splitMarkdownSections)
    expect(inlineEdit.joinMarkdownSections).toBe(joinMarkdownSections)
  })
})

/**
 * [Tfe960c47] Tầng mục con (`###`…`######`) — thêm ở task "inner collapse".
 *
 * Khác tầng `##` đúng một điểm và là điểm cố ý: tầng này NHẬN BIẾT code fence.
 * `splitMarkdownSections` không được phép biết, vì chỉ số mảnh của nó là hợp
 * đồng ghi file của inline edit (`useInlineMarkdownEdit`).
 */
describe('shallowestHeadingLevel — quét heading NGOÀI code fence (TC-A04…A11)', () => {
  it('TC-A04: `###` trong fence ~~~ không tính là heading', () => {
    expect(shallowestHeadingLevel('body\n\n~~~text\n### Không phải heading\n~~~\n')).toBe(0)
  })

  it('TC-A05: `###` trong fence ``` cũng không tính', () => {
    expect(shallowestHeadingLevel('body\n\n```md\n### Không phải heading\n```\n')).toBe(0)
  })

  // CommonMark: fence đóng phải cùng ký tự VÀ dài ít nhất bằng fence mở. Ba dấu
  // nháy bên trong fence bốn dấu chỉ là nội dung, không đóng fence ngoài.
  it('TC-A06: fence 4 ký tự bao fence 3 — fence trong không đóng fence ngoài', () => {
    expect(shallowestHeadingLevel('````\n```\n### x\n```\n````\n')).toBe(0)
  })

  it('TC-A07: `###foo` thiếu khoảng trắng ⇒ không phải heading', () => {
    expect(shallowestHeadingLevel('###foo\n')).toBe(0)
  })

  it('TC-A08: quá 6 dấu # ⇒ không phải heading', () => {
    expect(shallowestHeadingLevel('####### seven\n')).toBe(0)
  })

  it('TC-A11: `###### six` là cấp sâu nhất còn nhận', () => {
    expect(shallowestHeadingLevel('###### six\n')).toBe(6)
  })

  it('lấy cấp NÔNG NHẤT từ `min` trở xuống, bỏ qua cấp nông hơn `min`', () => {
    expect(shallowestHeadingLevel('## h2\n\n#### h4\n\n### h3\n')).toBe(3)
    expect(shallowestHeadingLevel('## h2\n\n#### h4\n', 3)).toBe(4)
    // `min` mặc định là 3 ⇒ tài liệu chỉ có `#`/`##` không sinh mục con nào.
    expect(shallowestHeadingLevel('# h1\n\n## h2\n')).toBe(0)
  })

  /**
   * ⚠️ Chênh lệch CÓ CHỦ Ý với CommonMark, giống cách `test-spec.md` TC-A19 chốt
   * cho setext: thụt lề tới 3 ô vẫn là heading theo CommonMark (marked render ra
   * `<h3>`), nhưng `scanHeadings` neo `^#` nên không coi là ranh giới gập — đúng
   * bằng luật đã có ở tầng `##` (`/^(?=##\s)/m`) từ trước task này.
   *
   * Hệ quả: heading thụt lề vẫn HIỆN (nằm trong `intro` của node cha), chỉ là
   * không gập được. Không mất chữ ⇒ không đổi hợp đồng nào.
   */
  it('thụt lề ⇒ không phải ranh giới gập (chênh lệch đã biết với CommonMark)', () => {
    expect(shallowestHeadingLevel('   ### three\n')).toBe(0)
    // 4 ô thì cả CommonMark lẫn hiện thực đều thống nhất: đó là code block.
    expect(shallowestHeadingLevel('    ### four\n')).toBe(0)
  })
})

describe('splitByHeadingLevel — cắt đúng một cấp (TC-A02, TC-A13)', () => {
  const BODY = '\n\nDẫn nhập.\n\n### A.1\n\nx\n\n#### A.1.1\n\ny\n\n### A.2\n\nz\n'

  it('mảnh dẫn đứng riêng, mỗi heading mở đầu một mảnh', () => {
    const parts = splitByHeadingLevel(BODY, 3)
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('\n\nDẫn nhập.\n\n')
    expect(parts[1].startsWith('### A.1')).toBe(true)
    expect(parts[2].startsWith('### A.2')).toBe(true)
  })

  // TC-A02: bất biến sống còn — `blockLineRanges` và inline edit đều dựa vào nó.
  it('TC-A02: ghép lại đúng NGUYÊN VĂN nguồn, không thêm bớt ký tự nào', () => {
    for (const src of [BODY, '### chỉ một\n', '', '   \n', 'không có heading nào']) {
      expect(splitByHeadingLevel(src, 3).join('')).toBe(src)
    }
  })

  it('TC-A13: cấp sâu hơn nằm TRONG mảnh của anh nó, không cắt ra ngoài', () => {
    const parts = splitByHeadingLevel(BODY, 3)
    expect(parts[1]).toContain('#### A.1.1')
    expect(parts[2]).not.toContain('#### A.1.1')
  })

  it('không có heading đúng cấp ⇒ trả nguyên nguồn làm một mảnh', () => {
    expect(splitByHeadingLevel('chỉ là đoạn văn', 3)).toEqual(['chỉ là đoạn văn'])
    expect(splitByHeadingLevel('', 3)).toEqual([])
  })

  it('TC-A22: CRLF không làm lệch điểm cắt, và vẫn ghép lại nguyên văn', () => {
    const crlf = BODY.replace(/\n/g, '\r\n')
    const parts = splitByHeadingLevel(crlf, 3)
    expect(parts).toHaveLength(3)
    expect(parts.join('')).toBe(crlf)
  })
})
