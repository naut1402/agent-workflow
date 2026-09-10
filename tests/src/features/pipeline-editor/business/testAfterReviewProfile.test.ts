import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'

const ROOT = path.resolve(import.meta.dir, '..', '..', '..', '..', '..')
const PROFILE = path.join(ROOT, 'docs/template/pipeline/test-after-review.yaml')

interface Step {
  id: string
  export_key: string
  agent: string
  produces?: string[]
  rule_category?: string
  hitl?: { mode?: string; blocking?: boolean; retry?: { restart_from?: string } }
}

/**
 * Profile "viết test sau review" là cách duy nhất mô hình tách test được cấu
 * hình — nếu thứ tự bước sai thì test lại được viết trên source chưa chốt, tức
 * là quay về đúng chi phí mà việc tách đang muốn bỏ. Thứ tự ở đây là hợp đồng,
 * không phải chi tiết trình bày.
 */
describe('profile test-after-review.yaml', () => {
  const doc = yaml.load(fs.readFileSync(PROFILE, 'utf8')) as { version: number; steps: Step[] }
  const ids = doc.steps.map((s) => s.id)

  test('parse được và có version schema như các profile khác', () => {
    expect(doc.version).toBe(1)
    expect(Array.isArray(doc.steps)).toBe(true)
  })

  test('bước viết test nằm NGAY SAU reviewer', () => {
    expect(ids.indexOf('test-implementer')).toBe(ids.indexOf('reviewer') + 1)
  })

  test('bước viết test nằm TRƯỚC pr-creator — PR phải mô tả được cả phần test', () => {
    expect(ids.indexOf('test-implementer')).toBeLessThan(ids.indexOf('pr-creator'))
  })

  test('test-spec vẫn soạn trước implement (spec đi trước code)', () => {
    expect(ids.indexOf('test-designer')).toBeLessThan(ids.indexOf('implementer'))
  })

  test('gate của reviewer quay vòng về implementer, không về test-implementer', () => {
    const reviewer = doc.steps.find((s) => s.id === 'reviewer')!
    expect(reviewer.hitl?.blocking).toBe(true)
    // Vòng retry không được chạm bước viết test: đó là cơ chế khiến test chỉ
    // được viết ở vòng cuối, khi source đã chốt.
    expect(reviewer.hitl?.retry?.restart_from).toBe('implementer')
  })

  test('step test-implementer khai đủ khoá mà runner cần', () => {
    const step = doc.steps.find((s) => s.id === 'test-implementer')!
    expect(step).toMatchObject({
      export_key: 'test_implementer',
      agent: 'dev-agent-teams:test-implementer',
      rule_category: 'test',
    })
    // `produces[0]` là mốc "done" mà dashboard dùng để vẽ phase strip.
    expect(step.produces?.[0]).toBe('test-result.md')
  })

  test('mọi step có export_key duy nhất', () => {
    const keys = doc.steps.map((s) => s.export_key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('có agent template cho mọi agent dev-agent-teams được khai', () => {
    for (const step of doc.steps) {
      const name = step.agent.replace(/^dev-agent-teams:/, '')
      expect(fs.existsSync(path.join(ROOT, 'docs/template/agents', `${name}.md`))).toBe(true)
    }
  })
})
