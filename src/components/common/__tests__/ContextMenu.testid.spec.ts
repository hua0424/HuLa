import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import ContextMenu from '@/components/common/ContextMenu.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': {
      menu: { ctx_menu_more: '更多' }
    }
  }
})

const triggerContextMenu = async (element: Element) => {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 100
  })
  element.dispatchEvent(event)
  await flushPromises()
}

describe('ContextMenu testid 透传', () => {
  it('普通菜单项的 testid 会渲染到 DOM', async () => {
    const wrapper = mount(ContextMenu, {
      props: {
        menu: [{ label: '测试', icon: 'setting', testid: 'test-normal-item' }]
      },
      global: {
        plugins: [i18n]
      },
      slots: {
        default: '<div class="trigger">右键我</div>'
      }
    })

    await triggerContextMenu(wrapper.find('.trigger').element)

    const item = document.querySelector('[data-testid="test-normal-item"]')
    expect(item).not.toBeNull()
  })

  it('special 菜单项的 testid 会渲染到 DOM', async () => {
    const wrapper = mount(ContextMenu, {
      props: {
        menu: [],
        specialMenu: [{ label: '退出', icon: 'logout', testid: 'test-special-item' }]
      },
      global: {
        plugins: [i18n]
      },
      slots: {
        default: '<div class="trigger">右键我</div>'
      }
    })

    await triggerContextMenu(wrapper.find('.trigger').element)

    const item = document.querySelector('[data-testid="test-special-item"]')
    expect(item).not.toBeNull()
  })
})
