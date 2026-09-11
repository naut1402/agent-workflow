#!/usr/bin/env bun
/**
 * Suy ref hai chiều giữa dòng source (`main` / `dev/x.y.z/**`) và dòng test
 * (`test/main` / `test/x.y.z/**`). Quy tắc thuần tên branch — không đọc file
 * cấu hình nào, nên chạy được ở cả CI (chỉ có `github.ref_name`) và máy dev.
 *
 * Bất biến: tên không khớp thì **throw**, không fallback về `main`. Đoán sai
 * làm CI xanh giả trên source sai version, mà xanh giả còn tệ hơn đỏ.
 *
 *   bun .github/scripts/test-ref.ts source test/1.1.3/Ta581d495_x   # → dev/1.1.3/main
 *   bun .github/scripts/test-ref.ts test   dev/1.1.3/main           # → test/1.1.3/main
 */
import process from 'node:process'

const VERSION = String.raw`\d+\.\d+\.\d+`

/** Ref dòng test → ref dòng source tương ứng (branch dòng version, không phải branch task). */
export function sourceRefOf(testRef: string): string {
  if (testRef === 'test/main') return 'main'
  const m = new RegExp(`^test/(${VERSION})/.+`).exec(testRef)
  if (!m) throw new Error(`Không suy được source ref từ "${testRef}" — tên branch dòng test phải là "test/main" hoặc "test/x.y.z/<slug>"`)
  return `dev/${m[1]}/main`
}

/** Ref dòng source → ref dòng test tương ứng. Dùng ở cổng phát hành và bước thăng dòng test. */
export function testLineOf(sourceRef: string): string {
  if (sourceRef === 'main') return 'test/main'
  const m = new RegExp(`^dev/(${VERSION})/.+`).exec(sourceRef)
  if (!m) throw new Error(`Không suy được test ref từ "${sourceRef}" — tên branch dòng source phải là "main" hoặc "dev/x.y.z/<slug>"`)
  return `test/${m[1]}/main`
}

/**
 * Tên branch task (ở cả hai dòng) → taskID; branch đầu dòng → `null`.
 *
 * Tách ở dấu `_` **cuối cùng**: `git-pr.md` §4.2 quy định `{task-slug}` là
 * kebab-case (không chứa `_`), còn `{taskID}` thì **được phép** có `_`
 * (`commitlint.config.js`) — `B202608_2201`, `20260911_001`. Tách ở dấu `_`
 * đầu tiên sẽ cắt `B202608_2201` thành `B202608`, tức ghép cặp vào một task
 * không tồn tại.
 *
 * Thuần theo tên như cả file này: 🚫 không đọc gì bên ngoài. Phần có I/O (dò ref
 * thật trên remote) nằm ở `pair-source.ts`.
 *
 *   taskIdOfBranch('test/1.1.5/T3166f31f_mode-toggle')            // → 'T3166f31f'
 *   taskIdOfBranch('dev/1.1.5/B202608_2201_sqlite-log-driver')    // → 'B202608_2201'
 *   taskIdOfBranch('test/1.1.5/main')                             // → null
 */
export function taskIdOfBranch(ref: string): string | null {
  // `(.+)` tham lam ⇒ khớp tới dấu `_` cuối cùng mà phần đuôi vẫn là kebab-case.
  const m = new RegExp(`^(?:dev|test)/(?:${VERSION})/(.+)_([a-z0-9-]+)$`).exec(ref)
  return m ? m[1] : null
}

/** Version của một ref bất kỳ ở hai dòng; `main` / `test/main` không mang version. */
export function versionOf(ref: string): string | null {
  const m = new RegExp(`^(?:dev|test)/(${VERSION})/`).exec(ref)
  return m ? m[1] : null
}

function main(argv: string[]): number {
  const [direction, ref] = argv
  if (!direction || !ref) {
    console.error('Cách dùng: bun .github/scripts/test-ref.ts <source|test|version> <ref>')
    return 2
  }
  try {
    if (direction === 'source') console.log(sourceRefOf(ref))
    else if (direction === 'test') console.log(testLineOf(ref))
    else if (direction === 'version') console.log(versionOf(ref) ?? 'main')
    else {
      console.error(`Chiều không hợp lệ: "${direction}" (source | test | version)`)
      return 2
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return 1
  }
  return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
