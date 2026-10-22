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
  loadDetail: vi.fn(),
  getConfig: vi.fn(),
  saveConfig: vi.fn()
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: vi.fn(() => ({
    getAiclawGroupConfig: mockFns.getConfig,
    loadAiclawGroupConfig: mockFns.loadConfig,
    loadAiclawGroupConfigs: mockFns.loadConfigs,
    loadAiclawGroupConfigDetail: mockFns.loadDetail,
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
    mockFns.loadDetail.mockReset().mockResolvedValue(true)
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

  // #456 A11：无配置不算成功加载，不得用默认值冒充已加载
  it('openModal 返回 true 但缓存无当前群配置时按加载失败处理，不伪造默认值', async () => {
    mockFns.loadConfig.mockResolvedValue(true)
    mockFns.getConfig.mockReturnValue(undefined)

    const wrapper = mountStore()
    await wrapper.vm.store.openModal('2001')
    await flushPromises()

    expect(wrapper.vm.store.modalLoading).toBe(false)
    expect(wrapper.vm.store.modalError).toBe('加载群聊配置失败')
    expect(wrapper.vm.store.modalContext).toBeNull()
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
    const message = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
    ;(window as any).$message = message
    try {
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
      // #457 A4：刷新走保存之后的新代次读取（detail），不复用保存前的旧请求
      expect(mockFns.loadDetail).toHaveBeenCalledWith(2001, 'room-1')
      expect(message.success).toHaveBeenCalledTimes(1)
      expect(message.warning).not.toHaveBeenCalled()
    } finally {
      delete (window as any).$message
    }
  })

  // #457 A13：保存成功 + 刷新失败 → 弹窗照常关闭，提示「已保存但未刷新」，既不误报保存失败也不宣称已刷新
  it('saveModal 保存成功但刷新失败时给独立提示，不误报保存失败', async () => {
    mockFns.loadDetail.mockResolvedValue(false)
    mockFns.getConfig.mockReturnValue(undefined)
    const message = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
    ;(window as any).$message = message
    try {
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

      expect(wrapper.vm.store.modalVisible).toBe(false)
      expect(wrapper.vm.store.modalSaving).toBe(false)
      expect(message.error).not.toHaveBeenCalled()
      expect(message.success).not.toHaveBeenCalled()
      expect(message.warning).toHaveBeenCalledWith('配置已保存，但刷新失败，界面可能不是最新')
    } finally {
      delete (window as any).$message
    }
  })

  // #457 A13/MF-2：刷新失败且共享缓存仍是保存前的值（弹窗打开时预填的旧值）→ 不得宣称已刷新
  it('saveModal 保存成功但刷新失败且缓存仍是旧值时，按刷新失败提示', async () => {
    mockFns.loadDetail.mockResolvedValue(false)
    mockFns.getConfig.mockReturnValue({
      roomId: 'room-1',
      rateLimitPerMinute: 3,
      dailyLimit: 1000,
      respondToAi: true,
      mentionRequired: true
    })
    const message = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
    ;(window as any).$message = message
    try {
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

      expect(message.success).not.toHaveBeenCalled()
      expect(message.warning).toHaveBeenCalledWith('配置已保存，但刷新失败，界面可能不是最新')
    } finally {
      delete (window as any).$message
    }
  })

  // #457 A13：刷新没拿到结果，但缓存已与本次提交一致 → 可以宣称已更新
  it('saveModal 刷新无结果但缓存已与提交一致时，给保存成功提示', async () => {
    mockFns.loadDetail.mockResolvedValue(false)
    mockFns.getConfig.mockReturnValue({
      roomId: 'room-1',
      rateLimitPerMinute: 10,
      dailyLimit: 1000,
      respondToAi: true,
      mentionRequired: true
    })
    const message = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
    ;(window as any).$message = message
    try {
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

      expect(message.success).toHaveBeenCalledTimes(1)
      expect(message.warning).not.toHaveBeenCalled()
    } finally {
      delete (window as any).$message
    }
  })

  // #457 A4/A10：旧保存流程不得关闭新弹窗、改新操作状态或发过时完成提示
  it('saveModal 保存期间弹窗被新上下文取代：不关闭新弹窗、不发过时提示', async () => {
    let releaseSave: () => void = () => {}
    mockFns.saveConfig.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        })
    )
    const message = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
    ;(window as any).$message = message
    try {
      const wrapper = mountStore()
      wrapper.vm.store.modalContext = {
        aiclawUid: '2001',
        roomId: 'room-1',
        config: { roomId: 'room-1', rateLimitPerMinute: 10, dailyLimit: 1000, respondToAi: true, mentionRequired: true }
      }
      wrapper.vm.store.modalVisible = true

      const pending = wrapper.vm.store.saveModal({
        roomId: 'room-1',
        rateLimitPerMinute: 10,
        dailyLimit: 1000,
        respondToAi: true,
        mentionRequired: true
      } as any)
      await flushPromises()

      // 期间用户为另一个群打开了新弹窗
      wrapper.vm.store.modalContext = {
        aiclawUid: '2001',
        roomId: 'room-2',
        config: { roomId: 'room-2', rateLimitPerMinute: 10, dailyLimit: 1000, respondToAi: true, mentionRequired: true }
      }
      wrapper.vm.store.modalVisible = true

      releaseSave()
      await pending
      await flushPromises()

      expect(wrapper.vm.store.modalVisible).toBe(true)
      expect(mockFns.loadDetail).not.toHaveBeenCalled()
      expect(message.success).not.toHaveBeenCalled()
      expect(message.warning).not.toHaveBeenCalled()
      expect(wrapper.vm.store.modalSaving).toBe(false)
    } finally {
      delete (window as any).$message
    }
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
