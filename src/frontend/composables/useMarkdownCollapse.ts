import { computed, ref } from 'vue'

/**
 * Lõi gập markdown hai tầng, dùng chung cho mọi viewer có block mode.
 *
 * Trước đây `openBlocks` / `onBlockToggle` tồn tại thành hai bản sao độc lập ở
 * `CMarkdownView.vue` và `ArtifactPanel.vue`, mỗi bên đều tự ghi chú "sửa một
 * bên thì sửa cả hai". Thêm tầng mục con vào hai bản sao sẽ thành bốn chỗ phải
 * đồng bộ, nên gộp về một lõi TRƯỚC rồi mới thêm tầng.
 *
 * Hai tầng cố ý không đối xứng:
 * - Tầng khối (`openBlocks`, chỉ số) có accordion.
 * - Tầng mục con (`openNodes`, path chuỗi) KHÔNG có accordion.
 */
export interface MarkdownCollapseOptions {
  blockCount: () => number
  nodePaths: () => string[]
  /** Accordion CHỈ áp cho tầng khối. */
  accordion: () => boolean
  /** Mặc định của khối — đã tính override accordion (`resolveArtifactSectionDefault`). */
  blockDefault: () => 'expanded' | 'collapsed'
  /** Mặc định của mục con — KHÔNG tính override accordion (`readArtifactSectionDefault`). */
  nodeDefault: () => 'expanded' | 'collapsed'
  /** Hook chạy sau mỗi lần có phần tử vừa mở — nơi viewer cắm `renderMermaid`. */
  onOpened?: () => void
}

export function useMarkdownCollapse(opts: MarkdownCollapseOptions) {
  const openBlocks = ref<Set<number>>(new Set())
  const openNodes = ref<Set<string>>(new Set())
  // Tập path đã từng thấy — để `prune` phân biệt "người dùng đã tự đóng" với
  // "mục con mới xuất hiện sau khi nội dung đổi".
  let knownPaths = new Set<string>()

  const allBlocksOpen = computed(() => {
    const count = opts.blockCount()
    return count > 0 && openBlocks.value.size === count
  })

  const allBlockIndexes = () => new Set(Array.from({ length: opts.blockCount() }, (_, i) => i))

  /**
   * Chỉ số mà CHÍNH TA vừa tự mở và đang chờ `<details>` bắn `toggle` phản xạ.
   *
   * Khi state đổi, Vue ghi thuộc tính `open` lên DOM và `<details>` bắn `toggle`
   * ở tick sau. Cú đó nhìn y hệt một lần bấm thật (`el.open === true`), nên nếu
   * không ghi nợ lại thì nó sẽ chạy nhánh accordion và thu sập đúng chỗ người
   * dùng đang đọc — hệt như bấm mở một block. Thời điểm phản xạ về lại phụ thuộc
   * lịch microtask, nên đây là lỗi chập chờn chứ không phải lỗi luôn tái hiện.
   *
   * 📌 Chỉ ghi nợ cho lần mở do TA ghi (`seed` / `prune` / `toggleAll`). Lần mở
   * do người dùng bấm thì DOM đã `open` TRƯỚC khi Vue ghi, nên Vue không đổi gì
   * và không hề có phản xạ nào để nuốt.
   */
  const pendingOpenReflections = new Set<number>()

  /** Ghi `openBlocks` theo đường lập trình — ghi nợ đúng những chỉ số vừa chuyển sang mở. */
  function writeOpenBlocks(next: Set<number>) {
    for (const i of next) if (!openBlocks.value.has(i)) pendingOpenReflections.add(i)
    for (const i of openBlocks.value) if (!next.has(i)) pendingOpenReflections.delete(i)
    openBlocks.value = next
  }

  function onBlockToggle(i: number, ev: Event) {
    const el = ev.target as HTMLDetailsElement
    if (el.open) {
      // Phản xạ của lần mở do ta tự ghi — nuốt đúng một lần, không đụng state.
      if (pendingOpenReflections.delete(i)) return
      // Accordion: mở block i ⇒ tập mở chỉ còn {i}. Các block anh em bị Vue đóng sẽ
      // bắn `toggle` vọng lại, rơi vào nhánh dưới và chỉ `delete` — idempotent, không lặp.
      openBlocks.value = opts.accordion() ? new Set([i]) : new Set(openBlocks.value).add(i)
      opts.onOpened?.()
    } else {
      // Đã đóng thật thì khoản nợ phản xạ (nếu còn) không bao giờ về nữa — xoá đi
      // để lần mở kế tiếp của người dùng không bị nuốt oan.
      pendingOpenReflections.delete(i)
      const next = new Set(openBlocks.value)
      next.delete(i)
      openBlocks.value = next
    }
  }

  function onNodeToggle(path: string, ev: Event) {
    // `<details>` lồng nhưng sự kiện `toggle` KHÔNG bubble, nên tầng trên không
    // bao giờ nhận được cú này — không cần `stopPropagation`.
    const el = ev.target as HTMLDetailsElement
    // Tầng mục con không có accordion ⇒ `toggle` trùng với trạng thái đang giữ
    // là vô nghĩa, bỏ qua thẳng. Đây cũng là chỗ nuốt toggle PHẢN XẠ: `seed` /
    // `toggleAll` mở sẵn N mục con, Vue ghi `open` lên từng `<details>` và mỗi
    // cái bắn lại một `toggle`. Không chặn thì mở một tài liệu là N lần dựng
    // `Set` mới + N lần re-render + N lần `onOpened` (quét mermaid toàn khung).
    //
    // 📌 Chặn theo trạng thái là AN TOÀN ở tầng này, khác tầng khối: state và
    // DOM luôn đồng pha (mọi lần đóng thật đều đi qua nhánh dưới), nên "đã mở
    // rồi lại mở" chỉ có thể là phản xạ, không thể là cú bấm thật.
    if (el.open === openNodes.value.has(path)) return
    const next = new Set(openNodes.value)
    if (el.open) {
      next.add(path)
      opts.onOpened?.()
    } else {
      next.delete(path)
    }
    openNodes.value = next
  }

  /** Gọi khi ĐỔI tài liệu — chỉ số của tài liệu trước không còn cùng ý nghĩa. */
  function seed() {
    const paths = opts.nodePaths()
    knownPaths = new Set(paths)
    // Tài liệu khác ⇒ nợ phản xạ của tài liệu cũ vô nghĩa. Bỏ dòng này thì một
    // khoản nợ không bao giờ được trả (ví dụ ghi lúc `blockMode` tắt, không
    // `<details>` nào tồn tại để bắn phản xạ về) sẽ sống qua nhiều lần đổi tài
    // liệu và nuốt oan cú bấm thật ở tài liệu sau.
    pendingOpenReflections.clear()
    writeOpenBlocks(opts.blockDefault() === 'expanded' ? allBlockIndexes() : new Set())
    openNodes.value = opts.nodeDefault() === 'expanded' ? new Set(paths) : new Set()
    if (openBlocks.value.size) opts.onOpened?.()
  }

  /** Gọi khi NẠP LẠI cùng tài liệu (poll `mtime`, lưu inline edit): giữ lựa chọn của người dùng. */
  function prune() {
    const max = opts.blockCount()
    writeOpenBlocks(new Set([...openBlocks.value].filter((i) => i < max)))
    const paths = opts.nodePaths()
    const alive = new Set(paths)
    const next = new Set([...openNodes.value].filter((p) => alive.has(p)))
    // Mục con mới xuất hiện sau khi sửa nội dung thì theo mặc định, chứ không
    // mặc định đóng — nếu không, sửa inline xong là nội dung mới tự biến mất.
    if (opts.nodeDefault() === 'expanded') {
      for (const p of paths) if (!knownPaths.has(p)) next.add(p)
    }
    knownPaths = alive
    openNodes.value = next
  }

  /** Nút "mở/thu tất cả" — áp cho CẢ HAI tầng. */
  function toggleAll() {
    if (allBlocksOpen.value) {
      writeOpenBlocks(new Set())
      openNodes.value = new Set()
    } else {
      writeOpenBlocks(allBlockIndexes())
      openNodes.value = new Set(opts.nodePaths())
      opts.onOpened?.()
    }
  }

  const isNodeOpen = (path: string) => openNodes.value.has(path)

  return {
    openBlocks,
    openNodes,
    allBlocksOpen,
    isNodeOpen,
    onBlockToggle,
    onNodeToggle,
    seed,
    prune,
    toggleAll,
  }
}
