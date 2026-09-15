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

describe('applyBudget — hai nấc, KHÔNG bao giờ cắt im lặng', () => {
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

  // Nấc 1 rút gọn "Kết quả các bước trước" một cách tất định: giữ tiêu đề `###`
  // và dòng `overall_confidence`, bỏ phần thân. Không còn nấc "nhờ LLM tóm tắt" —
  // một lượt LLM ẩn bên trong đường soạn brief là chi phí không ai nhìn thấy.
  test('nấc 1 — rút gọn "Kết quả các bước trước" mà KHÔNG gọi LLM nào', async () => {
    const huge = ['### Investigate', 'overall_confidence: High', 'x'.repeat(MAX_BRIEF_BYTES + 1_000)].join('\n')
    const out = await applyBudget([{ title: 'Kết quả các bước trước', body: huge }], assignment)
    expect(out).toContain('### Investigate')
    expect(out).toContain('overall_confidence: High')
    expect(out).not.toContain('ĐÃ LƯỢC BỎ')
    expect(out).toContain('làm X')
  })

  test('nấc 2 — phần không rút gọn được thì gắn nhãn ĐÃ LƯỢC BỎ, nêu rõ bỏ mục nào', async () => {
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

  // TC-16: một step in ra output rất lớn vẫn phải cho ra brief dùng được, và
  // phần bị bỏ phải được NÓI RA — 🚫 không âm thầm cắt rồi kết luận như đã đọc đủ.
  test('TC-16 — mọi phần đều quá khổ ⇒ vẫn trả brief hợp lệ kèm nhãn lược bỏ', async () => {
    const huge = 'x'.repeat(MAX_BRIEF_BYTES + 1_000)
    const out = await applyBudget(
      [
        { title: 'Bối cảnh task', body: huge },
        { title: 'Kết quả các bước trước', body: huge },
        { title: 'Knowledge', body: huge },
      ],
      assignment,
    )
    expect(out.startsWith('⚠️ ĐÃ LƯỢC BỎ')).toBe(true)
    expect(out).toContain('làm X')
  })
})

// AC-3 — node điều phối soạn bối cảnh cho bước kế. Chấm trên chuỗi brief trả về:
// đó chính là `job.userPrompt` mà người dùng đọc lại được trong job record.
describe('composeStepBrief — bối cảnh do node điều phối soạn (TC-15)', () => {
  test('summary của node đi vào brief thành một mục riêng, nhận ra được', async () => {
    seedTask('T5', { 'request.md': '# r' })
    const brief = await composeStepBrief({
      root,
      taskId: 'T5',
      stepId: 'implementer',
      reason: 'agent_start',
      agentContext: { summary: 'Investigate xong, chốt sửa ở decisionLoop.' },
    })
    expect(brief).toContain('Tóm tắt của node điều phối')
    expect(brief).toContain('Investigate xong, chốt sửa ở decisionLoop.')
  })

  test('context đi vào phần "việc của bạn" — thứ step đọc để biết phải làm gì', async () => {
    seedTask('T6', { 'request.md': '# r' })
    const brief = await composeStepBrief({
      root,
      taskId: 'T6',
      stepId: 'implementer',
      reason: 'agent_start',
      agentContext: { context: 'Ưu tiên nhánh job.finished, bỏ qua job chat.' },
    })
    expect(brief).toContain('Bối cảnh từ node điều phối')
    expect(brief).toContain('Ưu tiên nhánh job.finished, bỏ qua job chat.')
  })

  // AC-6 — pipeline KHÔNG bật điều phối phải nhận brief y hệt trước thay đổi.
  test('không có bối cảnh agent ⇒ brief không đổi một byte so với lượt thường', async () => {
    seedTask('T7', { 'request.md': '# r' })
    const base = await composeStepBrief({ root, taskId: 'T7', stepId: 'implementer', reason: 'advance' })
    for (const agentContext of [undefined, {}, { summary: '   ', context: '\n' }]) {
      const withEmpty = await composeStepBrief({
        root,
        taskId: 'T7',
        stepId: 'implementer',
        reason: 'advance',
        agentContext,
      })
      expect(withEmpty).toBe(base)
    }
    expect(base).not.toContain('node điều phối')
  })

  test('cả hai phần cùng có ⇒ cùng xuất hiện, không phần nào nuốt phần nào', async () => {
    seedTask('T8', { 'request.md': '# r' })
    const brief = await composeStepBrief({
      root,
      taskId: 'T8',
      stepId: 'reviewer',
      reason: 'agent_start',
      detail: 'phản hồi nguyên văn của người duyệt',
      agentContext: { summary: 'SUM-marker', context: 'CTX-marker' },
    })
    expect(brief).toContain('SUM-marker')
    expect(brief).toContain('CTX-marker')
    expect(brief).toContain('phản hồi nguyên văn của người duyệt')
  })
})
