#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { readRunners } from './lib/runners.js'

const ROOT = path.resolve(import.meta.dir, '..', '..')

function main(argv: string[]): number {
  let paths: string[]
  try {
    paths = readRunners(ROOT).bunTest
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return 1
  }

  const args = ['test', ...paths, ...argv]
  console.log(`$ bun ${args.join(' ')}\n`)
  const r = spawnSync('bun', args, { cwd: ROOT, stdio: 'inherit' })
  return r.status ?? 1
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
