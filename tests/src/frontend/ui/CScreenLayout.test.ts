import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import CScreenLayout from '@/frontend/ui/CScreenLayout.vue'

const BODY = '.c-screen-layout__body'
const NO_MAIN = 'c-screen-layout__body--no-main'
const LEFT_COLLAPSED = 'c-screen-layout__body--left-collapsed'

function mountLayout(props: Record<string, unknown> = {}, withLeft = true) {
  return mount(CScreenLayout, {
    props,
    slots: {
      main: () => h('div', { class: 'main-content' }, 'main'),
      ...(withLeft ? { left: () => h('div', { class: 'left-content' }, 'left') } : {}),
    },
  })
}

describe('CScreenLayout — modifier --no-main', () => {
  it('hideMain=false thì không gắn --no-main', () => {
    expect(mountLayout({ hideMain: false }).find(BODY).classes()).not.toContain(NO_MAIN)
  })

  it('hideMain=true + có slot left ⇒ gắn --no-main', () => {
    expect(mountLayout({ hideMain: true }).find(BODY).classes()).toContain(NO_MAIN)
  })

  // Không có slot `left` thì ẩn main là ẩn sạch màn hình — hideMain phải vô hiệu.
  it('không có slot left thì hideMain vô hiệu', () => {
    const body = mountLayout({ hideMain: true }, false).find(BODY)
    expect(body.classes()).not.toContain(NO_MAIN)
    expect(body.classes()).toContain('c-screen-layout__body--no-left')
  })

  // E1: thu sub-menu lúc chưa chọn agent không được ra màn hình trắng.
  it('--left-collapsed thắng --no-main', () => {
    const body = mountLayout({ hideMain: true, subSidebarCollapsed: true }).find(BODY)
    expect(body.classes()).toContain(LEFT_COLLAPSED)
    expect(body.classes()).not.toContain(NO_MAIN)
  })

  it('main luôn được render kể cả khi --no-main bật', () => {
    const w = mountLayout({ hideMain: true })
    expect(w.find('.c-screen-layout__main').exists()).toBe(true)
    expect(w.find('.main-content').exists()).toBe(true)
  })

  it('mặc định hideMain là false', () => {
    expect(mountLayout().find(BODY).classes()).not.toContain(NO_MAIN)
  })

  it('đổi hideMain lúc chạy thì modifier bật/tắt theo', async () => {
    const w = mountLayout({ hideMain: true })
    expect(w.find(BODY).classes()).toContain(NO_MAIN)
    await w.setProps({ hideMain: false })
    expect(w.find(BODY).classes()).not.toContain(NO_MAIN)
  })
})
