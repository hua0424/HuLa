import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

/**
 * #155 移动端 More 面板：
 *   - 修复「视频」入口误用语音图标（应使用 #video-one）
 *   - 补齐每个功能入口的 data-testid / aria-label
 */

vi.mock('@/hooks/useAiclawSession', () => ({
  useAiclawSession: () => ({
    allowedUploadTypes: ref(null)
  })
}))

vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({
    currentSession: ref({ type: 1, roomId: 'room-1' })
  })
}))

vi.mock('@/router', () => ({
  default: { push: vi.fn() }
}))

import More from '../More.vue'

const slotStub = { template: '<div><slot /></div>' }
const uploaderStub = {
  template: '<div class="van-uploader-stub"><slot /></div>'
}

const mountMore = () =>
  mount(More, {
    global: {
      stubs: {
        'van-swipe': slotStub,
        'van-swipe-item': slotStub,
        'van-popup': true,
        'van-uploader': uploaderStub
      }
    }
  })

describe('#155 移动端 More 面板图标与 testid', () => {
  it('渲染 5 个功能入口并带有对应 testid', () => {
    const wrapper = mountMore()
    const expected = ['file', 'image', 'video', 'history', 'videocall']
    for (const key of expected) {
      const item = wrapper.find(`[data-testid="mobile-more-item-${key}"]`)
      expect(item.exists()).toBe(true)
      expect(item.attributes('aria-label')).toBeTruthy()
    }
  })

  it('视频入口使用 #video-one 图标，不再复用语音 #voice 图标', () => {
    const wrapper = mountMore()
    const videoItem = wrapper.get('[data-testid="mobile-more-item-video"]')
    const use = videoItem.find('use')
    expect(use.exists()).toBe(true)
    expect(use.attributes('href')).toBe('#video-one')
    expect(use.attributes('href')).not.toBe('#voice')
  })

  it('文件与图片入口渲染 van-uploader，其余入口直接渲染 svg', () => {
    const wrapper = mountMore()
    expect(wrapper.find('[data-testid="mobile-more-item-file"] .van-uploader-stub').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mobile-more-item-image"] .van-uploader-stub').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mobile-more-item-history"] .van-uploader-stub').exists()).toBe(false)
  })
})
