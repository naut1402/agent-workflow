// Tb4241005 · TC-86, TC-87 — hệ quả quan sát được của D12 (tách `tasks/reads.ts`).
//
// TC-85 không có code riêng: nó là ràng buộc "suite `monitor/business` xanh mà
// KHÔNG sửa một assert nào". Phải sửa assert ở đây nghĩa là hành vi đã đổi và
// D12 bị vi phạm.

import { describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as tasks from '../../../../../src/features/monitor/business/tasks/index.js'

const READS_MODULE = path.resolve(
  import.meta.dir,
  '../../../../../src/features/monitor/business/tasks/reads.ts',
)

describe('public surface của tasks/index.ts (D12)', () => {
  test('TC-86: 5 tên đọc vẫn ra ở barrel — không caller nào phải sửa import', () => {
    for (const name of ['resolveArtifact', 'listArtifacts', 'readState', 'collectTasks']) {
      expect(typeof (tasks as any)[name]).toBe('function')
    }
    expect(tasks.MACHINE_FILES).toBeInstanceOf(Set)
    expect(tasks.MACHINE_FILES.size).toBeGreaterThan(0)
  })

  test('TC-86b: các export sẵn có khác vẫn còn', () => {
    for (const name of [
      'flowProfilePath',
      'createTask',
      'renderRequestMarkdown',
      'runTaskStep',
      'cleanupTaskWorktreeForTask',
    ]) {
      expect(typeof (tasks as any)[name]).toBe('function')
    }
  })
})

describe('reads.ts không kéo theo hạ tầng chạy nền (D11)', () => {
  test('TC-87: nhập reads.js xong, tiến trình tự thoát mã 0', async () => {
    // Lý do tồn tại của D12 diễn đạt dưới dạng quan sát được: barrel đầy đủ kéo
    // theo runner → job queue + sqlite + `node:child_process`; handle của chúng
    // giữ event loop và tiến trình stdio của `mcp/` sẽ treo thay vì thoát.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reads-exit-'))
    const entry = path.join(dir, 'entry.ts')
    fs.writeFileSync(
      entry,
      `const m = await import(${JSON.stringify(READS_MODULE)})\n`
        + `if (typeof m.collectTasks !== 'function') throw new Error('bad surface')\n`,
    )
    try {
      const code = await new Promise<number | 'timeout'>((resolve) => {
        const child = spawn('bun', [entry], { stdio: 'ignore' })
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve('timeout')
        }, 10_000)
        child.on('exit', (exitCode) => {
          clearTimeout(timer)
          resolve(exitCode ?? -1)
        })
      })
      expect(code).toBe(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 20_000)
})
