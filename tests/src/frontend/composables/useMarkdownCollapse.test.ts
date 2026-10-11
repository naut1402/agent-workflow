import { describe, expect, it, vi } from 'vitest'
import { useMarkdownCollapse } from '@/frontend/composables/useMarkdownCollapse'

/**
 * [Tfe960c47] Lõi gập hai tầng — nhóm §4 của `test-spec.md` + ba nhóm ca mà
 * `review.md` §4 nêu là chưa có ai canh.
 *
 * Hai tầng cố ý KHÔNG đối xứng, và đó là thứ nhóm này tồn tại để chốt:
 * - tầng khối (`openBlocks`, chỉ số) CÓ accordion;
 * - tầng mục con (`openNodes`, path chuỗi) KHÔNG có accordion.
 *
 * Trước task này `CMarkdownView` và `ArtifactPanel` mỗi bên giữ một bản sao
 * logic gập; gộp về đây nghĩa là mọi ca dưới đây nói về CẢ HAI viewer.
 */

/** Cây mẫu: block 0 có `A.1` (có con `A.1.1`) và `A.2`; block 1 và 2 không có mục con. */
const PATHS = ['0/0', '0/0/0', '0/1']

type Defaults = 'expanded' | 'collapsed'

interface Knobs {
  blockCount: number
  nodePaths: string[]
  accordion: boolean
  blockDefault: Defaults
  nodeDefault: Defaults
}

/**
 * `<details>` bắn `toggle` với `event.target.open` là trạng thái SAU khi đổi —
 * đúng thứ `onBlockToggle` / `onNodeToggle` đọc. Không cần element thật.
 */
const ev = (open: boolean) => ({ target: { open } }) as unknown as Event

function setup(overrides: Partial<Knobs> = {}) {
  const knobs: Knobs = {
    blockCount: 3,
    nodePaths: PATHS,
    accordion: false,
    blockDefault: 'expanded',
    nodeDefault: 'expanded',
    ...overrides,
  }
  const onOpened = vi.fn()
  const collapse = useMarkdownCollapse({
    blockCount: () => knobs.blockCount,
    nodePaths: () => knobs.nodePaths,
    accordion: () => knobs.accordion,
    blockDefault: () => knobs.blockDefault,
    nodeDefault: () => knobs.nodeDefault,
    onOpened,
  })
  return { knobs, onOpened, ...collapse }
}

/** Trạng thái mở của từng path, theo thứ tự `PATHS` — dễ đọc hơn so Set. */
const nodeStates = (c: { isNodeOpen: (p: string) => boolean }, paths = PATHS) =>
  paths.map((p) => c.isNodeOpen(p))

describe('useMarkdownCollapse — seed theo preference (TC-B01…B03)', () => {
  it('TC-B01: nodeDefault "expanded" ⇒ mọi mục con mở ngay sau seed', () => {
    const c = setup({ nodeDefault: 'expanded' })
    c.seed()
    expect(nodeStates(c)).toEqual([true, true, true])
  })

  it('TC-B02: nodeDefault "collapsed" ⇒ mọi mục con đóng', () => {
    const c = setup({ nodeDefault: 'collapsed', blockDefault: 'expanded' })
    c.seed()
    expect(nodeStates(c)).toEqual([false, false, false])
    // Tầng khối vẫn theo mặc định CỦA NÓ — không lây từ tầng mục con.
    expect([...c.openBlocks.value].sort()).toEqual([0, 1, 2])
  })

  it('TC-B03: hai tầng seed độc lập, không lẫn mặc định của nhau', () => {
    const c = setup({ blockDefault: 'collapsed', nodeDefault: 'expanded' })
    c.seed()
    expect([...c.openBlocks.value]).toEqual([])
    expect(nodeStates(c)).toEqual([true, true, true])
  })

  it('TC-B15: tài liệu không có mục con ⇒ không ném lỗi, mở/thu tất cả vẫn chạy', () => {
    const c = setup({ nodePaths: [] })
    expect(() => c.seed()).not.toThrow()
    expect(() => c.toggleAll()).not.toThrow()
    expect(() => c.toggleAll()).not.toThrow()
    expect(c.openNodes.value.size).toBe(0)
  })
})

describe('useMarkdownCollapse — toggle mục con (TC-B04, TC-B05, TC-B14)', () => {
  it('TC-B04: toggle mục con không đụng block cha, không đụng mục anh em', () => {
    const c = setup()
    c.seed()
    c.onNodeToggle('0/0', ev(false))

    expect(nodeStates(c)).toEqual([false, true, true])
    expect(c.openBlocks.value.has(0)).toBe(true)
  })

  it('TC-B05: toggle mục lồng sâu chỉ đổi chính nó', () => {
    const c = setup()
    c.seed()
    c.onNodeToggle('0/0/0', ev(false))

    expect(nodeStates(c)).toEqual([true, false, true])
    expect(c.openBlocks.value.has(0)).toBe(true)
  })

  it('TC-B14: toggle hai lần quay về đúng trạng thái ban đầu', () => {
    const c = setup()
    c.seed()
    const before = nodeStates(c)
    c.onNodeToggle('0/0', ev(false))
    c.onNodeToggle('0/0', ev(true))
    expect(nodeStates(c)).toEqual(before)
  })

  /**
   * TC-B16: hiện thực KHÔNG chủ động chặn path lạ — nó ghi vào `openNodes` rồi
   * `prune()` dọn ở nhịp sau. Path chỉ sinh ra từ `collectNodePaths` nên ngoài
   * test không có đường nào gọi tới đây, và entry rác không đổi trạng thái của
   * mục con thật nào. Chốt đúng hai điều đó.
   */
  it('TC-B16: path không tồn tại — không ném lỗi, không đổi mục con thật, `prune` dọn sạch', () => {
    const c = setup()
    c.seed()
    expect(() => c.onNodeToggle('9/9', ev(true))).not.toThrow()
    expect(nodeStates(c)).toEqual([true, true, true])

    c.prune()
    expect(c.isNodeOpen('9/9')).toBe(false)
    expect([...c.openNodes.value].sort()).toEqual([...PATHS].sort())
  })
})

describe('useMarkdownCollapse — accordion CHỈ áp tầng khối (TC-B06, TC-B07)', () => {
  it('TC-B06: mở block B ⇒ block A đóng, nhưng trạng thái mục con giữ nguyên', () => {
    const c = setup({ accordion: true, blockDefault: 'collapsed', nodeDefault: 'expanded' })
    c.seed()
    c.onBlockToggle(0, ev(true))
    expect([...c.openBlocks.value]).toEqual([0])

    c.onBlockToggle(1, ev(true))
    expect([...c.openBlocks.value]).toEqual([1])
    // Mục con của A không bị accordion cuốn theo — chúng thuộc tầng khác.
    expect(nodeStates(c)).toEqual([true, true, true])
  })

  it('TC-B07: accordion KHÔNG áp cho mục con — mở A.2 không đóng A.1', () => {
    const c = setup({ accordion: true, nodeDefault: 'collapsed' })
    c.seed()
    c.onNodeToggle('0/0', ev(true))
    c.onNodeToggle('0/1', ev(true))

    expect(c.isNodeOpen('0/0')).toBe(true)
    expect(c.isNodeOpen('0/1')).toBe(true)
  })

  it('block anh em bị Vue đóng bắn `toggle` vọng lại ⇒ idempotent, không lặp', () => {
    const c = setup({ accordion: true, blockDefault: 'collapsed' })
    c.seed()
    c.onBlockToggle(0, ev(true))
    c.onBlockToggle(1, ev(true))
    // Cú vọng của block 0 vừa bị Vue đóng.
    c.onBlockToggle(0, ev(false))

    expect([...c.openBlocks.value]).toEqual([1])
  })
})

describe('useMarkdownCollapse — mở/thu tất cả (TC-B08, TC-B09)', () => {
  it('TC-B08: mở tất cả phủ CẢ HAI tầng, kể cả mục con cấp 4', () => {
    const c = setup({ blockDefault: 'collapsed', nodeDefault: 'collapsed' })
    c.seed()
    c.toggleAll()

    expect([...c.openBlocks.value].sort()).toEqual([0, 1, 2])
    expect(nodeStates(c)).toEqual([true, true, true])
    expect(c.allBlocksOpen.value).toBe(true)
  })

  it('TC-B09: thu tất cả phủ CẢ HAI tầng', () => {
    const c = setup()
    c.seed()
    expect(c.allBlocksOpen.value).toBe(true)
    c.toggleAll()

    expect([...c.openBlocks.value]).toEqual([])
    expect(nodeStates(c)).toEqual([false, false, false])
    expect(c.allBlocksOpen.value).toBe(false)
  })

  it('allBlocksOpen là false khi không có block nào — không "rỗng tức là đủ"', () => {
    const c = setup({ blockCount: 0, nodePaths: [] })
    c.seed()
    expect(c.allBlocksOpen.value).toBe(false)
  })
})

describe('useMarkdownCollapse — đổi tài liệu & đổi nội dung (TC-B10…B12)', () => {
  it('TC-B10: `seed` cho tài liệu mới bỏ sạch trạng thái của tài liệu trước', () => {
    const c = setup()
    c.seed()
    c.onNodeToggle('0/0', ev(false))
    c.onBlockToggle(1, ev(false))

    c.knobs.nodePaths = ['0/0', '1/0']
    c.knobs.blockCount = 2
    c.seed()

    expect([...c.openBlocks.value].sort()).toEqual([0, 1])
    expect(nodeStates(c, ['0/0', '1/0'])).toEqual([true, true])
  })

  it('TC-B11: `prune` bỏ mục con đã biến mất, giữ nguyên mục con còn sống', () => {
    const c = setup()
    c.seed()
    c.onNodeToggle('0/0', ev(false))

    c.knobs.nodePaths = ['0/0', '0/0/0'] // `0/1` bị xoá khỏi nguồn
    c.prune()

    expect([...c.openNodes.value].sort()).toEqual(['0/0/0'])
    expect(c.isNodeOpen('0/0')).toBe(false) // lựa chọn của người dùng còn nguyên
  })

  it('TC-B12: mục con MỚI nhận mặc định hiện hành, không mặc nhiên đóng', () => {
    const c = setup({ nodeDefault: 'expanded' })
    c.seed()

    c.knobs.nodePaths = [...PATHS, '0/2']
    c.prune()
    expect(c.isNodeOpen('0/2')).toBe(true)
  })

  it('TC-B12b: mặc định "collapsed" ⇒ mục con mới vẫn đóng', () => {
    const c = setup({ nodeDefault: 'collapsed' })
    c.seed()

    c.knobs.nodePaths = [...PATHS, '0/2']
    c.prune()
    expect(c.isNodeOpen('0/2')).toBe(false)
  })

  it('`prune` bỏ chỉ số block không còn tồn tại, giữ chỉ số còn lại', () => {
    const c = setup()
    c.seed()
    c.knobs.blockCount = 2
    c.prune()
    expect([...c.openBlocks.value].sort()).toEqual([0, 1])
  })
})

describe('useMarkdownCollapse — callback "vừa mở" (TC-B13)', () => {
  it('TC-B13: bắn đúng một lần khi mở, 🚫 không bắn khi đóng', () => {
    const c = setup({ nodeDefault: 'collapsed', blockDefault: 'collapsed' })
    c.seed()
    c.onOpened.mockClear()

    c.onNodeToggle('0/0', ev(true))
    expect(c.onOpened).toHaveBeenCalledTimes(1)

    c.onNodeToggle('0/0', ev(false))
    expect(c.onOpened).toHaveBeenCalledTimes(1)

    c.onNodeToggle('0/0', ev(true))
    expect(c.onOpened).toHaveBeenCalledTimes(2)
  })

  it('seed mở sẵn block ⇒ bắn đúng MỘT lần cho cả lượt, không một lần mỗi block', () => {
    const c = setup({ blockDefault: 'expanded' })
    c.seed()
    expect(c.onOpened).toHaveBeenCalledTimes(1)
  })

  it('seed mà không mở block nào ⇒ không bắn', () => {
    const c = setup({ blockDefault: 'collapsed', nodeDefault: 'collapsed' })
    c.seed()
    expect(c.onOpened).not.toHaveBeenCalled()
  })
})

/**
 * [review.md §4 ①] Cơ chế **nuốt toggle phản xạ**.
 *
 * Khi state đổi, Vue ghi `open` lên `<details>` và trình duyệt bắn `toggle` ở
 * tick sau. Cú đó nhìn y hệt một lần bấm thật, nên nếu không ghi nợ lại thì nó
 * chạy nhánh accordion và thu sập đúng chỗ người dùng đang đọc. Trước nhóm này
 * cơ chế chỉ được canh GIÁN TIẾP qua `ArtifactPanel`.
 */
describe('useMarkdownCollapse — nuốt toggle phản xạ ở tầng khối (review §4 ①)', () => {
  it('(a) `toggleAll()` rồi phản xạ về đủ 3 chỉ số ⇒ tập mở KHÔNG thu về một phần tử', () => {
    const c = setup({ accordion: true, blockDefault: 'collapsed', nodeDefault: 'collapsed' })
    c.seed()

    c.toggleAll()
    expect([...c.openBlocks.value].sort()).toEqual([0, 1, 2])

    // Phản xạ của chính lần mở đó — `accordion()` vẫn trả `true`.
    for (const i of [0, 1, 2]) c.onBlockToggle(i, ev(true))

    expect([...c.openBlocks.value].sort()).toEqual([0, 1, 2])
  })

  it('(a2) `seed` mở sẵn mọi block ⇒ phản xạ cũng bị nuốt hết', () => {
    const c = setup({ accordion: true, blockDefault: 'expanded' })
    c.seed()
    for (const i of [0, 1, 2]) c.onBlockToggle(i, ev(true))
    expect([...c.openBlocks.value].sort()).toEqual([0, 1, 2])
  })

  it('(b) cú bấm THẬT không bị nuốt — nợ chỉ trả đúng một lần', () => {
    const c = setup({ accordion: true, blockDefault: 'expanded' })
    c.seed()

    // Lượt 1: phản xạ, bị nuốt.
    c.onBlockToggle(0, ev(true))
    expect([...c.openBlocks.value].sort()).toEqual([0, 1, 2])

    // Lượt 2: người dùng bấm thật lên cùng chỉ số ⇒ accordion phải chạy.
    c.onBlockToggle(0, ev(true))
    expect([...c.openBlocks.value]).toEqual([0])
  })

  it('(b2) mở từ trạng thái đóng hẳn luôn là cú bấm thật, không bao giờ bị nuốt', () => {
    const c = setup({ accordion: true, blockDefault: 'collapsed', nodeDefault: 'collapsed' })
    c.seed()

    c.onBlockToggle(2, ev(true))
    expect([...c.openBlocks.value]).toEqual([2])
    expect(c.onOpened).toHaveBeenCalledTimes(1)
  })

  it('(b3) đóng thật rồi mở lại ⇒ mở lại được ngay, nợ cũ không nuốt oan', () => {
    const c = setup({ accordion: true, blockDefault: 'expanded' })
    c.seed()

    c.onBlockToggle(1, ev(false))
    expect(c.openBlocks.value.has(1)).toBe(false)

    c.onBlockToggle(1, ev(true))
    expect([...c.openBlocks.value]).toEqual([1])
  })

  /**
   * (c) `seed()` của tài liệu mới gọi `pendingOpenReflections.clear()`. Hợp đồng
   * quan sát được: sau khi đổi tài liệu, cú bấm mở ĐẦU TIÊN của người dùng luôn
   * có hiệu lực — bất kể tài liệu trước để lại trạng thái gì.
   */
  const PRIOR: Array<[string, (c: ReturnType<typeof setup>) => void]> = [
    ['chưa đụng gì', () => {}],
    ['đã mở hết bằng toggleAll', (c) => c.toggleAll()],
    ['đã nhận đủ phản xạ', (c) => [0, 1, 2].forEach((i) => c.onBlockToggle(i, ev(true)))],
    ['đã đóng tay vài block', (c) => [0, 2].forEach((i) => c.onBlockToggle(i, ev(false)))],
  ]

  it.each(PRIOR)('(c) tài liệu trước %s ⇒ cú bấm mở đầu tiên ở tài liệu mới vẫn có hiệu lực', (_label, prior) => {
    const c = setup({ accordion: true, blockDefault: 'expanded' })
    c.seed()
    prior(c)

    // Đổi sang tài liệu mới, mặc định đóng hết.
    c.knobs.blockDefault = 'collapsed'
    c.knobs.nodeDefault = 'collapsed'
    c.seed()
    expect([...c.openBlocks.value]).toEqual([])

    c.onBlockToggle(1, ev(true))
    expect([...c.openBlocks.value]).toEqual([1])
  })
})

/**
 * [review.md §4 ①] Tầng mục con nuốt phản xạ bằng **early-return theo trạng
 * thái** (không phải `queueMicrotask`): `toggle` trùng với trạng thái đang giữ
 * là vô nghĩa ở tầng không có accordion, nên bỏ qua thẳng.
 */
describe('useMarkdownCollapse — nuốt phản xạ ở tầng mục con (early-return)', () => {
  it('phản xạ của `seed` không sinh re-render / `onOpened` thừa', () => {
    const c = setup({ nodeDefault: 'expanded', blockDefault: 'collapsed' })
    c.seed()
    c.onOpened.mockClear()
    const before = c.openNodes.value

    for (const p of PATHS) c.onNodeToggle(p, ev(true))

    expect(c.onOpened).not.toHaveBeenCalled()
    // Không dựng `Set` mới ⇒ tham chiếu giữ nguyên ⇒ không invalidate render nào.
    expect(c.openNodes.value).toBe(before)
    expect(nodeStates(c)).toEqual([true, true, true])
  })

  it('phản xạ của `toggleAll` cũng bị nuốt hết', () => {
    const c = setup({ nodeDefault: 'collapsed', blockDefault: 'collapsed' })
    c.seed()
    c.toggleAll()
    c.onOpened.mockClear()
    const before = c.openNodes.value

    for (const p of PATHS) c.onNodeToggle(p, ev(true))

    expect(c.onOpened).not.toHaveBeenCalled()
    expect(c.openNodes.value).toBe(before)
  })

  it('`toggle` đóng trùng trạng thái đang đóng cũng là no-op', () => {
    const c = setup({ nodeDefault: 'collapsed', blockDefault: 'collapsed' })
    c.seed()
    const before = c.openNodes.value
    c.onNodeToggle('0/0', ev(false))
    expect(c.openNodes.value).toBe(before)
  })

  it('cú bấm thật (trạng thái LỆCH với state) luôn đi qua', () => {
    const c = setup({ nodeDefault: 'expanded', blockDefault: 'collapsed' })
    c.seed()
    c.onOpened.mockClear()

    c.onNodeToggle('0/0', ev(false))
    expect(c.isNodeOpen('0/0')).toBe(false)

    c.onNodeToggle('0/0', ev(true))
    expect(c.isNodeOpen('0/0')).toBe(true)
    expect(c.onOpened).toHaveBeenCalledTimes(1)
  })
})
