import { describe, expect, test } from 'bun:test'
import { sourceRefOf, testLineOf, versionOf } from '../../.github/scripts/test-ref.js'

/**
 * Suy ref hai chiều source ↔ test. Bất biến quan trọng nhất **không** phải
 * "suy đúng" mà là "sai thì throw": fallback về `main` sẽ làm CI chạy suite của
 * version này trên source của version khác rồi báo xanh — xanh giả còn tệ hơn đỏ.
 */

describe('sourceRefOf', () => {
  test('test/main neo vào main', () => {
    expect(sourceRefOf('test/main')).toBe('main')
  })

  test('branch task dòng test → branch dòng version của source', () => {
    expect(sourceRefOf('test/1.1.3/Ta581d495_tach-test-code')).toBe('dev/1.1.3/main')
    expect(sourceRefOf('test/1.1.3/main')).toBe('dev/1.1.3/main')
  })

  test('version nhiều chữ số giữ nguyên', () => {
    expect(sourceRefOf('test/10.20.30/T1_x')).toBe('dev/10.20.30/main')
  })

  test.each([
    ['test/tach-test-code', 'thiếu version'],
    ['tests/1.1.3/x', 'sai namespace'],
    ['test/1.1.3/', 'slug rỗng'],
    ['test/1.1.3', 'thiếu slug'],
    ['test/main/foo', 'main không phải version'],
    ['test/1.1/x', 'version thiếu tầng'],
    ['feat/x', 'không thuộc dòng test'],
    ['dev/1.1.3/main', 'đưa ref source vào chiều ngược'],
    ['', 'chuỗi rỗng'],
  ])('throw với "%s" (%s)', (ref) => {
    expect(() => sourceRefOf(ref)).toThrow()
  })
})

describe('testLineOf', () => {
  test('main neo vào test/main', () => {
    expect(testLineOf('main')).toBe('test/main')
  })

  test('branch dòng source → dòng test của cùng version', () => {
    expect(testLineOf('dev/1.1.3/main')).toBe('test/1.1.3/main')
    expect(testLineOf('dev/1.1.3/Ta581d495_tach-test-code')).toBe('test/1.1.3/main')
  })

  test.each([
    ['dev/main', 'thiếu version'],
    ['dev/1.1.3', 'thiếu slug'],
    ['dev/1.1.3/', 'slug rỗng'],
    ['refactor/x', 'không thuộc dòng source'],
    ['test/1.1.3/main', 'đưa ref test vào chiều ngược'],
    ['', 'chuỗi rỗng'],
  ])('throw với "%s" (%s)', (ref) => {
    expect(() => testLineOf(ref)).toThrow()
  })
})

describe('sourceRefOf ∘ testLineOf', () => {
  // Hai chiều phải khép kín: đây là điều kiện để cổng phát hành và bước thăng
  // dòng test nói về cùng một cặp branch.
  test.each(['main', 'dev/1.1.3/main', 'dev/2.0.0/T1_abc'])('khép kín từ %s', (sourceRef) => {
    const back = sourceRefOf(testLineOf(sourceRef))
    expect(back).toBe(sourceRef === 'main' ? 'main' : sourceRef.replace(/^dev\/([^/]+)\/.*$/, 'dev/$1/main'))
  })
})

describe('versionOf', () => {
  test('lấy version từ cả hai dòng', () => {
    expect(versionOf('dev/1.1.3/main')).toBe('1.1.3')
    expect(versionOf('test/1.1.3/T1_x')).toBe('1.1.3')
  })

  test('ref gốc của dòng không mang version', () => {
    expect(versionOf('main')).toBe(null)
    expect(versionOf('test/main')).toBe(null)
  })
})
