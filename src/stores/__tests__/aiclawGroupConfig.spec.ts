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
  loadConfigs: vi.fn(),
  getConfigList: vi.fn(() => []),
  saveConfig: vi.fn()
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: vi.fn(() => ({
    getAiclawGroupConfigList: mockFns.getConfigList,
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
    mockFns.loadConfigs.mockReset()
    mockFns.getConfigList.mockReset().mockReturnValue([])
    mockFns.saveConfig.mockReset()
  })

  it('openModal 成功加载到当前群配置后写入 modalContext', async () => {
    mockFns.loadConfigs.mockResolvedValue(true)
    mockFns.getConfigList.mockReturnValue([
      {
        roomId: 'room-1',
        rateLimitPerMinute: 20,
        dailyLimit: 500,
        respondToAi: false,
        mentionRequired: false
      }
    ] as any)

    const wrapper = mountStore()
    await wrapper.vm.store.openModal('2001')
    await flushPromises()

    expect(mockFns.loadConfigs).toHaveBeenCalledWith(2001)
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

  it('openModal 成功但无当前群配置时使用默认值', async () => {
    mockFns.loadConfigs.mockResolvedValue(true)
    mockFns.getConfigList.mockReturnValue([
      {
        roomId: 'room-other',
        rateLimitPerMinute: 20,
        dailyLimit: 500,
        respondToAi: false,
        mentionRequired: false
      }
    ] as any)

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
    mockFns.loadConfigs.mockResolvedValue(false)

    const wrapper = mountStore()
    await wrapper.vm.store.openModal('2001')
    await flushPromises()

    expect(wrapper.vm.store.modalLoading).toBe(false)
    expect(wrapper.vm.store.modalError).toBe('加载群聊配置失败')
    expect(wrapper.vm.store.modalContext).toBeNull()
  })

  it('openModal 抛异常时设置 error 且 modalContext 为空', async () => {
    mockFns.loadConfigs.mockRejectedValue(new Error('network'))

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
