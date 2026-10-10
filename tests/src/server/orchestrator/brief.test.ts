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

// D4 — step.rule_category giờ đi vào brief qua `.dev-team-agent/project-rules.md`
// (sinh runtime nếu chưa có). Dùng workspace riêng (không phải `root` chung ở
// trên) vì cần kiểm soát `dirname(root)` — nơi `AGENTS.md`/`docs/agent-rules`
// được quét.
describe('composeStepBrief — Rule của project (D4, TC-09/TC-11/TC-12)', () => {
  let projRoot: string
  let wsRoot: string

  beforeAll(() => {
    projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-brief-rule-'))
    wsRoot = path.join(projRoot, '.dev-team-agent')
    fs.mkdirSync(wsRoot, { recursive: true })
    fs.writeFileSync(
      path.join(wsRoot, 'pipeline.yaml'),
      [
        'version: 1',
        'steps:',
        '  - { id: implementer, name: Implement, agent: "a:implementer", export_key: implementer, produces: [], rule_category: coding }',
        '  - { id: reviewer, name: Review, agent: "a:reviewer", export_key: reviewer, produces: [], rule_category: [coding, test] }',
        '  - { id: investigator, name: Investigate, agent: "a:investigator", export_key: investigator, produces: [] }',
      ].join('\n'),
      'utf8',
    )
  })
  afterAll(() => fs.rmSync(projRoot, { recursive: true, force: true }))

  function seedRuleTask(taskId: string) {
    const dir = path.join(wsRoot, 'tasks', taskId)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'request.md'), '# r', 'utf8')
  }

  test('step không khai rule_category ⇒ brief không có mục "Rule của project"', async () => {
    seedRuleTask('RN1')
    const brief = await composeStepBrief({ root: wsRoot, taskId: 'RN1', stepId: 'investigator', reason: 'advance' })
    expect(brief).not.toContain('Rule của project')
  })

  test('có rule_category nhưng project không có rule nào ⇒ nêu rõ "Chưa thiết lập", không im lặng (TC-11)', async () => {
    seedRuleTask('R1')
    const brief = await composeStepBrief({ root: wsRoot, taskId: 'R1', stepId: 'implementer', reason: 'advance' })
    expect(brief).toContain('Rule của project')
    expect(brief).toContain('Chưa thiết lập rule cho category này.')
  })

  test('rule nhúng trong AGENTS.md ⇒ nội dung thật xuất hiện trong brief (TC-09/TC-10)', async () => {
    fs.writeFileSync(path.join(projRoot, 'AGENTS.md'), '## Coding convention\n\nDùng 2 space, không tab.\n', 'utf8')
    fs.rmSync(path.join(wsRoot, 'project-rules.md'), { force: true }) // step trước đã sinh sẵn — xoá để test lại từ đầu
    seedRuleTask('R2')
    const brief = await composeStepBrief({ root: wsRoot, taskId: 'R2', stepId: 'implementer', reason: 'advance' })
    expect(brief).toContain('Dùng 2 space, không tab.')
  })

  test('rule_category là mảng ⇒ brief chứa đủ cả hai category, không mất category nào (TC-12)', async () => {
    fs.rmSync(path.join(wsRoot, 'project-rules.md'), { force: true })
    fs.mkdirSync(path.join(projRoot, 'docs', 'agent-rules'), { recursive: true })
    fs.writeFileSync(path.join(projRoot, 'docs', 'agent-rules', 'testing.md'), 'Nội dung rule test.', 'utf8')
    seedRuleTask('R3')
    const brief = await composeStepBrief({ root: wsRoot, taskId: 'R3', stepId: 'reviewer', reason: 'advance' })
    expect(brief).toContain('Dùng 2 space, không tab.') // coding — vẫn còn từ AGENTS.md ở test trước
    expect(brief).toContain('Nội dung rule test.') // test — từ docs/agent-rules
  })

  test('project-rules.md do đường điều phối khác ghi trước ⇒ đọc nguyên văn, không bị ghi đè (TC-13)', async () => {
    const dest = path.join(wsRoot, 'project-rules.md')
    fs.writeFileSync(dest, '# Project Convention Rules\n\n## Rule coding\n**Nguồn**: CLI ngoài\nRule do CLI ngoài ghi.\n', 'utf8')
    seedRuleTask('R4')
    const brief = await composeStepBrief({ root: wsRoot, taskId: 'R4', stepId: 'implementer', reason: 'advance' })
    expect(brief).toContain('Rule do CLI ngoài ghi.')
    expect(fs.readFileSync(dest, 'utf8')).toContain('Rule do CLI ngoài ghi.')
  })
})

/*
 * T6427b18c TC-44 — brief dạy nút con kênh trả kết quả.
 *
 * Nút điều phối chạy phiên riêng và chỉ đọc một dòng `STEP_SUMMARY` + danh sách
 * artifact; nếu brief không nói ra điều đó thì nút con không có lý do gì để in
 * dòng đó, và cha rơi về đuôi output ở MỌI lượt.
 */
describe('composeStepBrief — kênh con → cha (TC-44)', () => {
  test('brief có mục "Khi xong" yêu cầu dòng STEP_SUMMARY và chỉ rõ chi tiết nằm ở artifact', async () => {
    seedTask('T44', { 'request.md': '# r' })
    const brief = await composeStepBrief({ root, taskId: 'T44', stepId: 'implementer', reason: 'advance' })

    expect(brief).toContain('### Khi xong')
    expect(brief).toContain('STEP_SUMMARY:')
    expect(brief).toContain('artifact')
    expect(brief).toMatch(/không nằm trong output/)
  })

  test('mọi reason đều mang mục này — kênh không phụ thuộc lý do dispatch', async () => {
    seedTask('T45', { 'request.md': '# r' })
    for (const reason of ['advance', 'gate_rejected', 'review_retry'] as const) {
      const brief = await composeStepBrief({ root, taskId: 'T45', stepId: 'implementer', reason, detail: 'x' })
      expect(brief).toContain('### Khi xong')
      expect(brief).toContain('STEP_SUMMARY:')
    }
  })
})
