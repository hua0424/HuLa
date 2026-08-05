import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createI18n, useI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'
import homeZh from '~/locales/zh-CN/home.json'

vi.mock('@/stores/global', () => ({
  useGlobalStore: vi.fn(() => ({
    currentSessionRoomId: 'room-1',
    currentSession: { type: 1 }
  }))
}))

const mockFns = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  loadConfigs: vi.fn(),
  getConfig: vi.fn(),
  saveConfig: vi.fn()
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: vi.fn(() => ({
    getAiclawGroupConfig: mockFns.getConfig,
    loadAiclawGroupConfig: mockFns.loadConfig,
    loadAiclawGroupConfigs: mockFns.loadConfigs,
    saveAiclawGroupConfig: mockFns.saveConfig
  }))
}))

import { useAiclawGroupConfigStore } from '@/stores/aiclawGroupConfig'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': {
      aiclaw: aiclawZh,
      home: homeZh
    }
  }
})

const TestComponent = defineComponent({
  setup() {
    useI18n()
    const store = useAiclawGroupConfigStore()
    return { store }
  },
  template: '<div />'
})

const mountStore = () => {
  setActivePinia(createPinia())
  return mount(TestComponent, {
    global: {
      plugins: [i18n]
    }
  })
}

describe('useAiclawGroupConfigStore', () => {
  beforeEach(() => {
    mockFns.loadConfig.mockReset()
    mockFns.loadConfigs.mockReset()
    mockFns.getConfig.mockReset().mockReturnValue(undefined)
    mockFns.saveConfig.mockReset()
  })

  // REQ-016 #196 F5：openModal 只查当前群（单数版），不遍历 aiclaw 历史出现过的所有房间——
  // userListMap 残留（退群/解散后 aiclaw 仍挂旧房间）会让复数版对陈旧房间 server 校验必炸，
  // 全局 toast + 整窗置错。
  it('openModal 调单数版 loadAiclawGroupConfig 且只传当前 roomId', async () => {
    mockFns.loadConfig.mockResolvedValue(true)
    mockFns.getConfig.mockReturnValue({
      roomId: 'room-1',
      rateLimitPerMinute: 20,
      dailyLimit: 500,
      respondToAi: false,
      mentionRequired: false
    } as any)

    const wrapper = mountStore()
    await wrapper.vm.store.openModal('2001')
    await flushPromises()

    expect(mockFns.loadConfig).toHaveBeenCalledWith(2001, 'room-1')
    expect(mockFns.loadConfigs).not.toHaveBeenCalled()
    expect(wrapper.vm.store.modalVisible).toBe(true)
    expect(wrapper.vm.store.modalLoading).toBe(false)
    expect(wrapper.vm.store.modalError).toBe('')
    expect(wrapper.vm.store.modalContext?.config).toMatchObject({
      roomId: 'room-1',
      rateLimitPerMinute: 20,
      dailyLimit: 500,
      respondToAi: false,
      mentionRequired: false
    })
  })

  it('openModal 成功但缓存无当前群配置时使用默认值', async () => {
    mockFns.loadConfig.mockResolvedValue(true)
    mockFns.getConfig.mockReturnValue(undefined)

    const wrapper = mountStore()
    await wrapper.vm.store.openModal('2001')
    await flushPromises()

    expect(wrapper.vm.store.modalContext?.config).toMatchObject({
      roomId: 'room-1',
      rateLimitPerMinute: 10,
      dailyLimit: 1000,
      respondToAi: true,
      mentionRequired: true
    })
  })

  it('openModal 加载返回 false 时设置 error 且 modalContext 为空', async () => {
    mockFns.loadConfig.mockResolvedValue(false)

    const wrapper = mountStore()
    await wrapper.vm.store.openModal('2001')
    await flushPromises()

    expect(wrapper.vm.store.modalLoading).toBe(false)
    expect(wrapper.vm.store.modalError).toBe('加载群聊配置失败')
    expect(wrapper.vm.store.modalContext).toBeNull()
  })

  it('openModal 抛异常时设置 error 且 modalContext 为空', async () => {
    mockFns.loadConfig.mockRejectedValue(new Error('network'))

    const wrapper = mountStore()
    await wrapper.vm.store.openModal('2001')
    await flushPromises()

    expect(wrapper.vm.store.modalLoading).toBe(false)
    expect(wrapper.vm.store.modalError).toBe('加载群聊配置失败')
    expect(wrapper.vm.store.modalContext).toBeNull()
  })

  it('saveModal 成功时关闭弹窗并清空 saving', async () => {
    const wrapper = mountStore()
    wrapper.vm.store.modalContext = {
      aiclawUid: '2001',
      roomId: 'room-1',
      config: {
        roomId: 'room-1',
        rateLimitPerMinute: 10,
        dailyLimit: 1000,
        respondToAi: true,
        mentionRequired: true
      }
    }
    wrapper.vm.store.modalVisible = true

    await wrapper.vm.store.saveModal({
      roomId: 'room-1',
      rateLimitPerMinute: 10,
      dailyLimit: 1000,
      respondToAi: true,
      mentionRequired: true
    } as any)
    await flushPromises()

    expect(mockFns.saveConfig).toHaveBeenCalledWith(2001, 'room-1', expect.any(Object))
    expect(wrapper.vm.store.modalSaving).toBe(false)
    expect(wrapper.vm.store.modalVisible).toBe(false)
  })

  it('saveModal 失败时保持弹窗打开并清空 saving', async () => {
    mockFns.saveConfig.mockRejectedValue(new Error('network'))

    const wrapper = mountStore()
    wrapper.vm.store.modalContext = {
      aiclawUid: '2001',
      roomId: 'room-1',
      config: {
        roomId: 'room-1',
        rateLimitPerMinute: 10,
        dailyLimit: 1000,
        respondToAi: true,
        mentionRequired: true
      }
    }
    wrapper.vm.store.modalVisible = true

    await wrapper.vm.store.saveModal({
      roomId: 'room-1',
      rateLimitPerMinute: 10,
      dailyLimit: 1000,
      respondToAi: true,
      mentionRequired: true
    } as any)
    await flushPromises()

    expect(wrapper.vm.store.modalSaving).toBe(false)
    expect(wrapper.vm.store.modalVisible).toBe(true)
  })
})
