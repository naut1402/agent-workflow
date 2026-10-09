#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { sourceRefOf, taskIdOfBranch, versionOf } from './test-ref.js'

/**
 * `taskid` ghép được branch task · `no-match` không còn branch nào (PR code đã
 * merge — đây là lượt có quyền merge PR test) · `ambiguous` ≥ 2 branch khớp ·
 * `lookup-failed` không dò được remote · `not-applicable` ref không mang taskID
 * hoặc không mang version.
 */
export type PairKind = 'taskid' | 'no-match' | 'ambiguous' | 'lookup-failed' | 'not-applicable'

export interface Pair {
  source: string
  paired: PairKind
  note: string
}

/**
 * Chọn branch dòng source từ kết quả dò remote.
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

function matchesOnRemote(version: string, taskId: string, remote: string): { refs: string[]; error?: string } {
  // xem docs/architecture/code/tooling.md §2
  const r = spawnSync('git', ['ls-remote', '--heads', remote, `refs/heads/dev/${version}/${taskId}_*`], { encoding: 'utf8' })
  if (r.status !== 0) {
    const why = (r.stderr ?? '').replace(/\s+/g, ' ').trim() || `git thoát ${r.status}`
    console.error(`::warning::Không dò được branch dòng source cho taskID ${taskId} — lùi về đầu dòng version. ${why}`)
    return { refs: [], error: why }
  }
  const refs = (r.stdout ?? '')
    .split('\n')
    .map((l) => l.split('\t')[1]?.trim() ?? '')
    .filter(Boolean)
    .map((ref) => ref.replace(/^refs\/heads\//, ''))
  // xem docs/architecture/code/tooling.md §2
  return { refs: refs.filter((ref) => taskIdOfBranch(ref) === taskId) }
}

export function resolvePair(testRef: string, headRef: string, remote = 'origin'): Pair {
  const fallback = sourceRefOf(testRef)
  const version = versionOf(testRef)
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
  console.log(`source=${pair.source}`)
  console.log(`paired=${pair.paired}`)
  console.log(`note=${pair.note.replace(/\s+/g, ' ')}`)
  return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
