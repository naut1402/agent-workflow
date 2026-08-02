#!/usr/bin/env bun
/**
 * CI gate: fail if docs/todo exists at all.
 * When deferred debt is cleared, the docs/todo directory must be removed entirely.
 * Invoked by workflow Todo debt (PR targeting version main) via `bun run check:todo`.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(process.cwd(), 'docs', 'todo')

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) out.push(...listFiles(full))
    else out.push(full)
  }
  return out
}

if (!fs.existsSync(root)) {
  console.log('OK: docs/todo does not exist.')
  process.exit(0)
}

const files = listFiles(root)
console.error('FAIL: docs/todo must not exist when promoting version main → main (remove the whole directory after clearing debt).')
if (files.length === 0) {
  console.error('  - docs/todo/ exists but is empty — delete the directory')
} else {
  for (const f of files) {
    console.error(`  - ${path.relative(process.cwd(), f).split(path.sep).join('/')}`)
  }
}
console.error('See docs/implement/todo-debt-convention.md')
process.exit(1)
