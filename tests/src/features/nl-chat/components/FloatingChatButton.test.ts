import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestI18nPlugin } from '../../../helpers/i18n'
import FloatingChatButton from '@/features/nl-chat/components/FloatingChatButton.vue'

/** Chữ `vi` NGUYÊN BẢN của tooltip nút nổi trước khi migrate — chép từ `FloatingChatButton.vue` bản cũ. */
const VI_BEFORE_TITLE = 'Tạo mới bằng chat'

const COMPONENT_SOURCE = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../../src/features/nl-chat/components/FloatingChatButton.vue',
  ),
  'utf8',
)

const mounted: { unmount: () => void }[] = []

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
})

function render(locale: 'vi' | 'en') {
  const wrapper = mount(FloatingChatButton, {
    props: { projectId: 'P1' },
    global: { plugins: [createTestI18nPlugin(locale)] },
  })
  mounted.push(wrapper)
  return wrapper
}

describe('FloatingChatButton — tooltip đã i18n hoá', () => {
  it('bản `vi` giống HỆT chuỗi cứng trước thay đổi', () => {
    expect(render('vi').find('.nl-chat-fab').attributes('title')).toBe(VI_BEFORE_TITLE)
  })

  it('đổi locale thì tooltip đổi theo, không lộ khoá thô', () => {
    const vi = render('vi').find('.nl-chat-fab').attributes('title')
    const en = render('en').find('.nl-chat-fab').attributes('title')
    expect(en).toBeTruthy()
    expect(en).not.toBe(vi)
    expect(en).not.toMatch(/nlChat\./)
  })

  it('chuỗi cứng cũ đã rời khỏi template', () => {
    expect(COMPONENT_SOURCE).not.toContain(VI_BEFORE_TITLE)
    expect(COMPONENT_SOURCE).toContain(`t('nlChat.floating.open')`)
  })
})
