import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  applyBudget,
  composeStepBrief,
  summarizeExport,
} from '../../../../src/features/orchestrator/business/brief.js'
import { MAX_BRIEF_BYTES } from '../../../../src/features/orchestrator/schemas/orchestrator.js'

// Brief là thứ thay `request.md` thô làm prompt của mỗi step (bối cảnh #2 của
// đề bài). Chấm theo **nội dung chuỗi trả về** — đó cũng chính là `job.userPrompt`
// mà người dùng đọc lại được trong job record.

let root: string

const STEPS = [
  { id: 'investigator', name: 'Investigate', export_key: 'investigator', produces: ['investigate.md'] },
  { id: 'implementer', name: 'Implement', export_key: 'implementer', produces: [] },
  { id: 'reviewer', name: 'Review', export_key: 'reviewer', produces: ['review.md'] },
]

function seedTask(taskId: string, files: Record<string, string>) {
  const dir = path.join(root, 'tasks', taskId)
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body, 'utf8')
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-brief-'))
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    [
      'version: 1',
      'orchestrator: { enabled: true, agent: "a:orch" }',
      'steps:',
      ...STEPS.map(
        (s) =>
          `  - { id: ${s.id}, name: ${s.name}, agent: "a:${s.id}", export_key: ${s.export_key}, produces: [${s.produces.join(', ')}] }`,
      ),
    ].join('\n'),
    'utf8',
  )
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('composeStepBrief — bốn phần của brief', () => {
  test('gộp request + kết quả bước trước + việc của bạn', async () => {
    seedTask('T1', {
      'request.md': '# Yêu cầu\n\nThêm node điều phối.',
      'pipeline-export.json': JSON.stringify({
        phases: {
          investigator: { overall_confidence: 'High', files_to_modify: ['a.ts', 'b.ts'] },
          // Phase của CHÍNH step đang chạy không được đưa vào "bước trước".
          implementer: { overall_confidence: 'Low' },
        },
      }),
    })

    const brief = await composeStepBrief({ root, taskId: 'T1', stepId: 'implementer', reason: 'advance' })

    expect(brief).toContain('Thêm node điều phối.')
    expect(brief).toContain('Investigate')
    expect(brief).toContain('a.ts')
    expect(brief).toContain('Implement')
    expect(brief).toContain('Bước trước đã xong')
    // `implementer` là step đang chạy, không phải "bước trước" của chính nó.
    expect(brief).not.toContain('Low')
  })

  test('reason gate_rejected mang NGUYÊN VĂN phản hồi xuống step — đây là kênh giao tiếp giữa hai node', async () => {
    seedTask('T2', { 'request.md': '# r' })
    const feedback = 'Thiếu test cho nhánh lỗi ở decisionLoop, bổ sung rồi báo lại.'
    const brief = await composeStepBrief({
      root,
      taskId: 'T2',
      stepId: 'implementer',
      reason: 'gate_rejected',
      detail: feedback,
    })
    expect(brief).toContain(feedback)
  })

  test('thiếu request.md ⇒ ném lỗi (task hỏng, không chạy với prompt rỗng)', async () => {
    fs.mkdirSync(path.join(root, 'tasks', 'T3'), { recursive: true })
    await expect(composeStepBrief({ root, taskId: 'T3', stepId: 'implementer', reason: 'advance' })).rejects.toThrow()
  })

  test('step có produces thì brief nói rõ phải tạo file gì', async () => {
    seedTask('T4', { 'request.md': '# r' })
    const brief = await composeStepBrief({ root, taskId: 'T4', stepId: 'reviewer', reason: 'advance' })
    expect(brief).toContain('review.md')
  })
})

describe('summarizeExport — degrade khi thiếu pipeline-export.json', () => {
  test('không có file ⇒ nói thẳng là chưa có + liệt kê artifact đang tồn tại', () => {
    const text = summarizeExport(null, STEPS, 'implementer', ['investigate.md', 'design.md'])
    expect(text).toContain('pipeline-export.json')
    expect(text).toContain('investigate.md')
    expect(text).toContain('design.md')
  })

  test('không có file và cũng chưa có artifact nào', () => {
    expect(summarizeExport(null, STEPS, 'investigator', [])).toContain('chưa có artifact nào')
  })

  test('step đầu tiên không có "bước trước" nào', () => {
    const text = summarizeExport({ phases: { investigator: { overall_confidence: 'High' } } }, STEPS, 'investigator', [])
    expect(text).toContain('chưa ghi dữ liệu export')
  })

  test('mảng rỗng bị bỏ — không tốn chỗ trong ngân sách', () => {
    const text = summarizeExport(
      { phases: { investigator: { overall_confidence: 'High', open_questions: [] } } },
      STEPS,
      'implementer',
      [],
    )
    expect(text).toContain('overall_confidence')
    expect(text).not.toContain('open_questions')
  })
})

describe('applyBudget — ba nấc, KHÔNG bao giờ cắt im lặng', () => {
  const assignment = '## Việc của bạn\n\nlàm X'

  test('dưới ngưỡng ⇒ giữ nguyên mọi phần', async () => {
    const out = await applyBudget(
      [
        { title: 'Bối cảnh task', body: 'ngắn' },
        { title: 'Knowledge', body: 'cũng ngắn' },
      ],
      assignment,
    )
    expect(out).toContain('ngắn')
    expect(out).toContain('cũng ngắn')
    expect(out).toContain('làm X')
    expect(out).not.toContain('ĐÃ LƯỢC BỎ')
  })

  test('nấc 2 — callback condense được dùng khi vượt ngưỡng', async () => {
    const huge = 'x'.repeat(MAX_BRIEF_BYTES + 1_000)
    let called = false
    const out = await applyBudget([{ title: 'Bối cảnh task', body: huge }], assignment, {
      condense: async () => {
        called = true
        return 'bản tóm tắt ngắn gọn'
      },
    })
    expect(called).toBe(true)
    expect(out).toBe('bản tóm tắt ngắn gọn')
  })

  test('nấc 3 — không có condense ⇒ gắn nhãn ĐÃ LƯỢC BỎ, nêu rõ bỏ mục nào', async () => {
    const huge = 'x'.repeat(MAX_BRIEF_BYTES + 1_000)
    const out = await applyBudget(
      [
        { title: 'Bối cảnh task', body: huge },
        { title: 'Knowledge', body: 'ngắn' },
      ],
      assignment,
    )
    expect(out).toContain('ĐÃ LƯỢC BỎ')
    expect(out).toContain('Bối cảnh task')
    // Phần "việc của bạn" không bao giờ bị bỏ — thiếu nó thì step không biết làm gì.
    expect(out).toContain('làm X')
  })

  test('nấc 3 — condense trả về vẫn quá dài thì rơi tiếp xuống nhãn lược bỏ', async () => {
    const huge = 'x'.repeat(MAX_BRIEF_BYTES + 1_000)
    const out = await applyBudget([{ title: 'Bối cảnh task', body: huge }], assignment, {
      condense: async () => 'y'.repeat(MAX_BRIEF_BYTES + 500),
    })
    expect(out).toContain('ĐÃ LƯỢC BỎ')
  })

  test('condense ném lỗi cũng không làm hỏng brief', async () => {
    const huge = 'x'.repeat(MAX_BRIEF_BYTES + 1_000)
    const out = await applyBudget([{ title: 'Bối cảnh task', body: huge }], assignment, {
      condense: async () => {
        throw new Error('LLM down')
      },
    })
    expect(out).toContain('ĐÃ LƯỢC BỎ')
  })
})
