#!/usr/bin/env node
/** Cross-platform rsync stub — copies from RSYNC_STUB_FIXTURE tree locally. */
import fs from 'node:fs'
import path from 'node:path'

if (process.env.RSYNC_STUB_MODE === 'fail') {
  process.exit(1)
}

const logPath = process.env.RSYNC_STUB_LOG
if (logPath) {
  fs.appendFileSync(logPath, process.argv.slice(2).join(' ') + '\n')
}

const args = process.argv.slice(2)
let src = ''
let dest = ''
for (let i = args.length - 1; i >= 0; i--) {
  const a = args[i]
  if (a.startsWith('-')) continue
  if (!dest) dest = a
  else {
    src = a
    break
  }
}

if (!src || !dest) process.exit(1)

let remotePath = src
if (remotePath.includes(':')) {
  remotePath = remotePath.split(':').slice(1).join(':')
}

const fixtureRoot = process.env.RSYNC_STUB_FIXTURE
if (fixtureRoot && remotePath.startsWith('/')) {
  const rel = remotePath.replace(/^\//, '')
  const srcLocal = path.join(fixtureRoot, rel)
  if (fs.existsSync(srcLocal)) {
    fs.mkdirSync(path.dirname(dest.endsWith(path.sep) ? dest : dest), { recursive: true })
    if (fs.statSync(srcLocal).isDirectory()) {
      fs.mkdirSync(dest, { recursive: true })
      for (const entry of fs.readdirSync(srcLocal)) {
        fs.cpSync(path.join(srcLocal, entry), path.join(dest, entry), { recursive: true })
      }
    } else {
      fs.cpSync(srcLocal, dest)
    }
    process.exit(0)
  }
}

fs.mkdirSync(dest, { recursive: true })
process.exit(0)
