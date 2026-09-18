import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_PIPELINE,
  loadPipelineConfig,
} from '../../../../../src/features/pipeline-editor/business/pipeline/index.js'

// Khoá `orchestrator` merge 3 tầng đúng khuôn `doc_reviewer` (mặc định ←
// project ← task). Cổng tương thích ngược nằm ở đây: file YAML không có khoá
// này phải đọc ra `enabled: false`.

let root: string

function writeGlobal(lines: string[]) {
  fs.writeFileSync(path.join(root, 'pipeline.yaml'), lines.join('\n'), 'utf8')
}

function writeTask(taskId: string, lines: string[]) {
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'pipeline.yaml'), lines.join('\n'), 'utf8')
}

const STEPS = ['steps:', '  - { id: implementer, name: Implement, agent: "a:impl" }']

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-cfg-'))
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('mặc định là TẮT (TC-03)', () => {
  test('DEFAULT_PIPELINE khai tường minh enabled: false', () => {
    expect(DEFAULT_PIPELINE.orchestrator).toMatchObject({ enabled: false })
  })

  test('pipeline.yaml không có khoá orchestrator ⇒ tắt', async () => {
    writeGlobal(['version: 1', ...STEPS])
    const cfg = await loadPipelineConfig(root, null)
    expect(cfg.orchestrator?.enabled).toBe(false)
  })

  test('không có pipeline.yaml nào ⇒ tắt', async () => {
    const cfg = await loadPipelineConfig(root, null)
    expect(cfg.orchestrator?.enabled).toBe(false)
  })
})

describe('merge 3 tầng (TC-09)', () => {
  test('project bật ⇒ task không có file riêng cũng bật', async () => {
    writeGlobal(['version: 1', 'orchestrator: { enabled: true, agent: "a:orch" }', ...STEPS])
    const cfg = await loadPipelineConfig(root, 'T1')
    expect(cfg.orchestrator).toMatchObject({ enabled: true, agent: 'a:orch' })
  })

  test('project TẮT + task BẬT ⇒ task thắng', async () => {
    writeGlobal(['version: 1', 'orchestrator: { enabled: false }', ...STEPS])
    writeTask('T2', ['orchestrator: { enabled: true, agent: "a:task" }'])
    expect((await loadPipelineConfig(root, 'T2')).orchestrator).toMatchObject({ enabled: true, agent: 'a:task' })
    // Task khác không có file riêng vẫn theo project.
    expect((await loadPipelineConfig(root, 'T3')).orchestrator?.enabled).toBe(false)
  })

  test('project BẬT + task TẮT ⇒ task thắng (chiều ngược lại)', async () => {
    writeGlobal(['version: 1', 'orchestrator: { enabled: true, agent: "a:orch" }', ...STEPS])
    writeTask('T4', ['orchestrator: { enabled: false }'])
    expect((await loadPipelineConfig(root, 'T4')).orchestrator?.enabled).toBe(false)
  })

  test('task chỉ ghi đè agent ⇒ kế thừa enabled của project', async () => {
    writeGlobal(['version: 1', 'orchestrator: { enabled: true, agent: "a:orch" }', ...STEPS])
    writeTask('T5', ['orchestrator: { agent: "a:khac" }'])
    expect((await loadPipelineConfig(root, 'T5')).orchestrator).toMatchObject({ enabled: true, agent: 'a:khac' })
  })
})

describe('loadPipelineConfig là tầng ĐỌC — không tự sửa config của người dùng', () => {
  // Sửa giá trị trả về ở đây sẽ theo `/api/pipeline-config` vào editor rồi bị
  // ghi bền ngược vào `pipeline.yaml` ở lần Save kế tiếp, mà người dùng không
  // hề chọn và cũng không thấy.
  test('bật orchestrator KHÔNG làm đổi defaults.export_json', async () => {
    writeGlobal([
      'version: 1',
      'defaults: { export_json: false }',
      'orchestrator: { enabled: true, agent: "a:orch" }',
      ...STEPS,
    ])
    const cfg = await loadPipelineConfig(root, null)
    expect(cfg.orchestrator?.enabled).toBe(true)
    expect(cfg.defaults.export_json).toBe(false)
  })

  test('giá trị export_json người dùng đặt được giữ nguyên', async () => {
    writeGlobal([
      'version: 1',
      'defaults: { export_json: true }',
      'orchestrator: { enabled: false }',
      ...STEPS,
    ])
    expect((await loadPipelineConfig(root, null)).defaults.export_json).toBe(true)
  })
})

describe('giá trị cấu hình lạ không làm hỏng việc đọc (TC-10)', () => {
  // `enabled` chỉ được coi là bật khi đúng boolean `true` — mọi giá trị khác
  // đọc ra "tắt", tức là ngả an toàn (pipeline chạy như cũ).
  for (const raw of ['"yes"', '1', 'null', '{}']) {
    test(`enabled: ${raw} ⇒ đọc ra TẮT`, async () => {
      writeGlobal(['version: 1', `orchestrator: { enabled: ${raw} }`, ...STEPS])
      const cfg = await loadPipelineConfig(root, null)
      expect(cfg.orchestrator?.enabled).not.toBe(true)
    })
  }

  test('orchestrator là chuỗi ⇒ không ném, vẫn đọc được steps', async () => {
    writeGlobal(['version: 1', 'orchestrator: "bat"', ...STEPS])
    const cfg = await loadPipelineConfig(root, null)
    expect(cfg.steps).toHaveLength(1)
    expect(cfg.orchestrator?.enabled).not.toBe(true)
  })
})
