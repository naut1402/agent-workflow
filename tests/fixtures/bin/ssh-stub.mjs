#!/usr/bin/env node
/** Cross-platform SSH stub for tests. Logs argv to SSH_STUB_LOG; succeeds for echo ok / claude. */
import fs from 'node:fs'

const logPath = process.env.SSH_STUB_LOG
if (logPath) {
  fs.appendFileSync(logPath, process.argv.slice(2).join(' ') + '\n')
}

const remoteCmd = process.argv[process.argv.length - 1] || ''
if (remoteCmd.includes('echo ok') || remoteCmd.includes('claude')) {
  process.exit(0)
}
process.exit(1)
