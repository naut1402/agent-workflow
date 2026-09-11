#!/usr/bin/env bun
/**
 * Chọn branch **dòng source** để ghép với một PR dòng test.
 *
 * Vì sao cần: `sourceRefOf()` suy thuần theo tên nên luôn cho đầu dòng version
 * (`dev/x.y.z/main`). Với một PR dòng test mở **trước** khi PR code merge, cây
 * đó chưa có source tương ứng ⇒ suite đỏ `TS2305`/`TS2307` suốt giai đoạn chờ.
 * Đỏ kiểu đó là "chưa tới lượt", không phải "hỏng thật", và khi nó thành mặc
 * định thì cổng hết phân biệt được hai thứ — đã dẫn tới việc một PR test đỏ
 * thật được merge vào dòng test.
 *
 * Cách ghép: cùng task thì hai dòng dùng **cùng `{taskID}`** (`git-pr.md` §4.2 ·
 * §4.3), nên taskID của branch PR (`github.head_ref`) dò ngược ra được branch
 * task dòng source.
 *
 * Bất biến: chỉ dùng ref **có thật** trên remote. 0 hoặc ≥ 2 branch khớp taskID
 * thì lùi về đầu dòng version — 🚫 không đoán từ tên, vì xanh giả tệ hơn đỏ.
 *
 *   bun .github/scripts/pair-source.ts test/1.1.5/main test/1.1.5/T3166f31f_mode-toggle
 *     → source=dev/1.1.5/T3166f31f_mode-toggle
 *       paired=taskid
 *       note=khớp taskID T3166f31f
 */
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { sourceRefOf, taskIdOfBranch, versionOf } from './test-ref.js'

/**
 * `taskid` ghép được branch task · `no-match` không còn branch nào (PR code đã
 * merge — đây là lượt **có quyền merge** PR test) · `ambiguous` ≥ 2 branch khớp ·
 * `lookup-failed` không dò được remote · `not-applicable` ref không mang taskID
 * hoặc không mang version.
 *
 * ⚠️ `lookup-failed` tách khỏi `no-match` có lý do: `no-match` được `git-pr.md`
 * §4.3 tài liệu hoá là **lượt có quyền merge** ("PR code đã merge, branch đã xoá").
 * Gộp lỗi tra cứu vào đó là khẳng định một điều chưa kiểm chứng về trạng thái merge
 * của dòng source — đúng loại xanh giả mà file này tuyên bố không được phép.
 */
export type PairKind = 'taskid' | 'no-match' | 'ambiguous' | 'lookup-failed' | 'not-applicable'

export interface Pair {
  source: string
  paired: PairKind
  note: string
}

/**
 * Phần quyết định, tách khỏi I/O để test được mà 🚫 không mock git.
 *
 * @param fallback đầu dòng version (`sourceRefOf(testRef)`) — dùng cho mọi ca không ghép được
 * @param taskId taskID suy từ `head_ref`, `null` nếu ref không mang
 * @param matches branch dòng source có thật trên remote, khớp taskID
 * @param lookupError lý do không dò được remote; có giá trị thì `matches` vô nghĩa
 */
export function choosePair(
  fallback: string,
  taskId: string | null,
  matches: string[],
  lookupError?: string,
): Pair {
  if (!taskId) return { source: fallback, paired: 'not-applicable', note: 'head ref không mang taskID' }
  if (lookupError) {
    return {
      source: fallback,
      paired: 'lookup-failed',
      note: `không dò được branch dòng source trên remote: ${lookupError} — lùi về đầu dòng version, 🚫 KHÔNG kết luận được PR code đã merge hay chưa`,
    }
  }
  if (matches.length === 1) return { source: matches[0], paired: 'taskid', note: `khớp taskID ${taskId}` }
  if (matches.length === 0) {
    return {
      source: fallback,
      paired: 'no-match',
      note: `không còn branch dev/*/${taskId}_* trên remote (PR code đã merge, hoặc branch chưa push)`,
    }
  }
  return {
    source: fallback,
    paired: 'ambiguous',
    note: `${matches.length} branch khớp ${taskId} — không chọn bừa: ${matches.join(' · ')}`,
  }
}

/**
 * Branch dòng source khớp taskID, đọc từ remote.
 *
 * ⚠️ Lỗi `ls-remote` (mất mạng, hết quyền) trả `failed` + ghi cảnh báo, 🚫 không
 * throw: "mất mạng" không được đọc thành "cổng hỏng". Hệ quả là lùi về
 * `fallback`, tức đúng hành vi của trước khi có ghép cặp — nhưng dưới tên
 * `lookup-failed`, 🚫 không mượn tên `no-match`.
 */
function matchesOnRemote(version: string, taskId: string, remote: string): { refs: string[]; error?: string } {
  // `spawnSync` KHÔNG qua shell ⇒ taskId (lấy từ tên branch do người mở PR đặt)
  // không nội suy được vào lệnh. Glob ở đây là glob của refspec, không của shell.
  const r = spawnSync('git', ['ls-remote', '--heads', remote, `refs/heads/dev/${version}/${taskId}_*`], { encoding: 'utf8' })
  if (r.status !== 0) {
    // Gộp khoảng trắng ngay tại nguồn: stderr của git nhiều dòng, mà `note` đi vào
    // `::error::` và bảng job summary — cả hai đều là bề mặt một dòng.
    const why = (r.stderr ?? '').replace(/\s+/g, ' ').trim() || `git thoát ${r.status}`
    console.error(`::warning::Không dò được branch dòng source cho taskID ${taskId} — lùi về đầu dòng version. ${why}`)
    return { refs: [], error: why }
  }
  const refs = (r.stdout ?? '')
    .split('\n')
    .map((l) => l.split('\t')[1]?.trim() ?? '')
    .filter(Boolean)
    .map((ref) => ref.replace(/^refs\/heads\//, ''))
  // Glob `_*` rộng hơn quy tắc tách: `_` vừa là dấu ngăn `{taskID}_{slug}` vừa là
  // ký tự HỢP LỆ trong taskID, nên `B202608_*` khớp cả branch của `B202608_2201`.
  // Đúng một khớp kiểu đó sẽ thành `paired: taskid` trên cây source của task KHÁC —
  // ref có thật trên remote nhưng không phải ref của task này. Chốt lại bằng chính
  // hàm thuần định nghĩa quy ước, 🚫 không nới rộng hơn nó.
  return { refs: refs.filter((ref) => taskIdOfBranch(ref) === taskId) }
}

export function resolvePair(testRef: string, headRef: string, remote = 'origin'): Pair {
  const fallback = sourceRefOf(testRef)
  const version = versionOf(testRef)
  // `test/main` không mang version ⇒ không có dòng `dev/x.y.z/**` nào để dò.
  const taskId = version ? taskIdOfBranch(headRef) : null
  const found = version && taskId ? matchesOnRemote(version, taskId, remote) : { refs: [] }
  return choosePair(fallback, taskId, found.refs, found.error)
}

function main(argv: string[]): number {
  const [testRef, headRef] = argv
  if (!testRef || !headRef) {
    console.error('Cách dùng: bun .github/scripts/pair-source.ts <test-ref> <head-ref>')
    return 2
  }
  let pair: Pair
  try {
    pair = resolvePair(testRef, headRef)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return 1
  }
  // Một dòng một khoá: bên gọi tách bằng `sed -n 's/^note=//p'`, 🚫 không `eval`.
  // Gộp khoảng trắng để `note` chắc chắn nằm gọn trên một dòng.
  console.log(`source=${pair.source}`)
  console.log(`paired=${pair.paired}`)
  console.log(`note=${pair.note.replace(/\s+/g, ' ')}`)
  return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
