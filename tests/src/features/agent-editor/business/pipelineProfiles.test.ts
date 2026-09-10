import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { listPipelineProfileNames } from '../../../../../src/features/agent-editor/business/agents'

// `listPipelineProfileNames` là nguồn duy nhất của "giá trị hợp lệ cho
// `profileName`" mà nl-chat bơm vào prompt builder — sai ở đây là builder điền
// ref không tồn tại và task âm thầm chạy pipeline mặc định.

let dirs: string[] = []
async function tmpRoot(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-profiles-'))
  dirs.push(d)
  return d
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })))
  dirs = []
})

describe('listPipelineProfileNames', () => {
  test('thư mục pipeline-profiles/ chưa tồn tại → [] (không throw)', async () => {
    const root = await tmpRoot()
    expect(await listPipelineProfileNames(root)).toEqual([])
  })

  test('root trỏ vào đường dẫn không tồn tại → [] (không throw)', async () => {
    const root = path.join(os.tmpdir(), 'khong-ton-tai-abcdef123')
    expect(await listPipelineProfileNames(root)).toEqual([])
  })

  test('bỏ .tmp, bỏ file không phải .yaml, bỏ thư mục con; sort tăng dần', async () => {
    const root = await tmpRoot()
    const dir = path.join(root, 'pipeline-profiles')
    await fs.mkdir(path.join(dir, 'sub-dir.yaml'), { recursive: true })
    await fs.writeFile(path.join(dir, 'review-pipeline.yaml'), 'version: 1\n')
    await fs.writeFile(path.join(dir, 'quality-first.yaml'), 'version: 1\n')
    await fs.writeFile(path.join(dir, 'dang-ghi.yaml.tmp'), 'version: 1\n')
    await fs.writeFile(path.join(dir, 'ghi-chu.md'), 'not a profile')

    expect(await listPipelineProfileNames(root)).toEqual(['quality-first', 'review-pipeline'])
  })

  // TC-37: đường tiêu thụ thật chạy `sanitiseProfileName` trước khi đọc file,
  // nên tên nào sanitise ra khác chính nó sẽ resolve về null → task âm thầm
  // chạy pipeline mặc định. Không được quảng cáo những tên đó.
  test('bỏ tên mà sanitiseProfileName không giữ nguyên văn (dấu, ký tự lạ, quá 64)', async () => {
    const root = await tmpRoot()
    const dir = path.join(root, 'pipeline-profiles')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'bao-cao.yaml'), 'version: 1\n')
    await fs.writeFile(path.join(dir, 'báo-cáo.yaml'), 'version: 1\n')
    await fs.writeFile(path.join(dir, 'deploy@prod.yaml'), 'version: 1\n')
    await fs.writeFile(path.join(dir, `${'d'.repeat(70)}.yaml`), 'version: 1\n')

    expect(await listPipelineProfileNames(root)).toEqual(['bao-cao'])
  })

  test('giữ tên có khoảng trắng / dấu chấm / gạch dưới — sanitise không đụng', async () => {
    const root = await tmpRoot()
    const dir = path.join(root, 'pipeline-profiles')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'release v1.1.yaml'), 'version: 1\n')
    await fs.writeFile(path.join(dir, 'quality_first.yaml'), 'version: 1\n')

    expect(await listPipelineProfileNames(root)).toEqual(['quality_first', 'release v1.1'])
  })
})
