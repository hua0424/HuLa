import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'
import homeZh from '~/locales/zh-CN/home.json'
import AiclawBatchGroupConfigModal from '@/components/aiclaw/AiclawBatchGroupConfigModal.vue'

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

const mockLoad = vi.fn()
const mockGetConfig = vi.fn()
const mockSave = vi.fn()
const mockAddGroupDetail = vi.fn()
const mockGetGroupDetail = vi.fn()

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    loadAiclawGroupConfigDetail: mockLoad,
    getAiclawGroupConfig: mockGetConfig,
    saveAiclawGroupConfig: mockSave
  })
}))

vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    addGroupDetail: mockAddGroupDetail,
    getGroupDetail: mockGetGroupDetail
  })
}))

vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: vi.fn()
}))

describe('AiclawBatchGroupConfigModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockLoad.mockReset()
    mockGetConfig.mockReset()
    mockSave.mockReset()
    mockAddGroupDetail.mockReset()
    mockGetGroupDetail.mockReset()
    mockLoad.mockResolvedValue(true)
    mockGetConfig.mockReturnValue(undefined)
    mockSave.mockResolvedValue(undefined)
    mockGetGroupDetail.mockReturnValue({ account: 'hula_g1' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  const mountModal = (props: {
    visible: boolean
    roomId: string
    account?: string
    aiclawItems: Array<{ uid: string; name?: string; adapterType?: string }>
  }) =>
    mount(AiclawBatchGroupConfigModal, {
      props,
      attachTo: document.body,
      global: {
        plugins: [i18n, createPinia()]
      }
    })

  it('visible=true 且包含 owner aiclaw 时渲染表单并预填默认工作目录', async () => {
    mountModal({
      visible: true,
      roomId: 'room-1',
      account: 'hula_g1',
      aiclawItems: [{ uid: '1001', name: 'OpenCode Bot', adapterType: 'opencode' }]
    })
    await flushPromises()

    expect(document.body.textContent).toContain('OpenCode Bot')
    const input = document.querySelector(
      '[data-testid="aiclaw-group-config-workspace-dir"] .n-input__input-el'
    ) as HTMLInputElement | null
    expect(input).not.toBeNull()
    expect(input?.value).toContain('~/.aichat/opencode/workspace/1001/group/hula_g1')
  })

  it('openclaw aiclaw 不显示工作目录输入', async () => {
    mountModal({
      visible: true,
      roomId: 'room-1',
      aiclawItems: [{ uid: '1002', name: 'OpenClaw Bot', adapterType: 'openclaw' }]
    })
    await flushPromises()

    expect(document.querySelector('[data-testid="aiclaw-group-config-workspace-dir"]')).toBeNull()
  })

  it('保存时调用 chatStore.saveAiclawGroupConfig 并携带 approved/workspaceDir', async () => {
    mountModal({
      visible: true,
      roomId: 'room-1',
      account: 'hula_g1',
      aiclawItems: [{ uid: '1001', name: 'OpenCode Bot', adapterType: 'opencode' }]
    })
    await flushPromises()

    const approvedSwitch = document.querySelector('[data-testid="aiclaw-group-config-approved"]') as HTMLElement | null
    expect(approvedSwitch).not.toBeNull()
    approvedSwitch?.click()
    await flushPromises()

    const saveButton = document.querySelector('[data-testid="aiclaw-group-config-save"]') as HTMLElement | null
    expect(saveButton).not.toBeNull()
    saveButton?.click()
    await flushPromises()

    expect(mockSave).toHaveBeenCalledTimes(1)
    const [uid, roomId, payload] = mockSave.mock.calls[0]
    expect(uid).toBe(1001)
    expect(roomId).toBe('room-1')
    expect(payload.approved).toBe(true)
    expect(payload.workspaceDir).toContain('~/.aichat/opencode/workspace/1001/group/hula_g1')
  })

  // REQ-016 #195 F3：弹窗先开后补的异常路径
  it('加载中显示骨架，完成后渲染表单', async () => {
    let release: (v: unknown) => void
    mockLoad.mockReturnValue(new Promise((r) => (release = r)))

    mountModal({
      visible: true,
      roomId: 'room-1',
      account: 'hula_g1',
      aiclawItems: [{ uid: '1001', name: 'OpenCode Bot', adapterType: 'opencode' }]
    })
    await flushPromises()

    // 配置加载在途：骨架可见、表单未渲染
    expect(document.querySelector('[data-testid="aiclaw-batch-config-loading"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="aiclaw-group-config-save"]')).toBeNull()

    release!(true)
    await flushPromises()
    expect(document.querySelector('[data-testid="aiclaw-batch-config-loading"]')).toBeNull()
    expect(document.querySelector('[data-testid="aiclaw-group-config-save"]')).not.toBeNull()
  })

  it('单数版只查当前 roomId（不遍历其他房间）', async () => {
    mountModal({
      visible: true,
      roomId: 'room-1',
      aiclawItems: [
        { uid: '1001', name: 'A', adapterType: 'opencode' },
        { uid: '1002', name: 'B', adapterType: 'cc' }
      ]
    })
    await flushPromises()

    expect(mockLoad).toHaveBeenCalledTimes(2)
    expect(mockLoad).toHaveBeenNthCalledWith(1, 1001, 'room-1')
    expect(mockLoad).toHaveBeenNthCalledWith(2, 1002, 'room-1')
  })

  it('配置加载失败显错误态且保存仍可用（默认配置兜底）；点重试重新加载', async () => {
    mockLoad.mockResolvedValue(false)
    mountModal({
      visible: true,
      roomId: 'room-1',
      account: 'hula_g1',
      aiclawItems: [{ uid: '1001', name: 'OpenCode Bot', adapterType: 'opencode' }]
    })
    await flushPromises()

    // 错误态可见，表单仍按默认配置渲染（保存可用性不依赖异步补数据）
    expect(document.querySelector('[data-testid="aiclaw-batch-config-error"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="aiclaw-group-config-save"]')).not.toBeNull()

    // 重试：恢复成功后错误态消失
    mockLoad.mockResolvedValue(true)
    const retryBtn = Array.from(document.querySelectorAll('[data-testid="aiclaw-batch-config-error"] button')).pop() as
      | HTMLElement
      | undefined
    retryBtn?.click()
    await flushPromises()

    expect(document.querySelector('[data-testid="aiclaw-batch-config-error"]')).toBeNull()
  })

  // #457 A13：保存成功但刷新失败 → 明确「已保存但刷新失败」，不误报保存失败
  it('A13：保存成功但刷新失败 → 提示已保存但刷新失败，不误报保存失败', async () => {
    const message = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
    ;(window as unknown as { $message: unknown }).$message = message
    mockLoad.mockResolvedValue(false)

    mountModal({
      visible: true,
      roomId: 'room-1',
      account: 'hula_g1',
      aiclawItems: [{ uid: '1001', name: 'OpenCode Bot', adapterType: 'opencode' }]
    })
    await flushPromises()

    ;(document.querySelector('[data-testid="aiclaw-group-config-save"]') as HTMLElement | null)?.click()
    await flushPromises()

    expect(mockSave).toHaveBeenCalledTimes(1)
    expect(message.error).not.toHaveBeenCalled()
    expect(message.success).not.toHaveBeenCalled()
    expect(message.warning).toHaveBeenCalledWith('配置已保存，但刷新失败，界面可能不是最新')
    delete (window as unknown as { $message?: unknown }).$message
  })

  // #457 A13/MF-2：刷新失败且缓存仍是保存前的值 → 不得宣称已刷新
  it('A13：刷新失败且缓存仍是保存前的值 → 仍提示已保存但刷新失败', async () => {
    const message = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
    ;(window as unknown as { $message: unknown }).$message = message
    mockLoad.mockResolvedValue(false)
    mockGetConfig.mockReturnValue({
      rateLimitPerMinute: 999,
      dailyLimit: 1000,
      respondToAi: true,
      mentionRequired: true,
      approved: false
    })

    mountModal({
      visible: true,
      roomId: 'room-1',
      account: 'hula_g1',
      aiclawItems: [{ uid: '1001', name: 'OpenCode Bot', adapterType: 'opencode' }]
    })
    await flushPromises()

    ;(document.querySelector('[data-testid="aiclaw-group-config-save"]') as HTMLElement | null)?.click()
    await flushPromises()

    expect(message.success).not.toHaveBeenCalled()
    expect(message.warning).toHaveBeenCalledWith('配置已保存，但刷新失败，界面可能不是最新')
    delete (window as unknown as { $message?: unknown }).$message
  })

  // #457 A13：刷新没拿到结果，但缓存已与本次提交一致 → 可以宣称已更新
  it('A13：刷新无结果但缓存已与提交一致 → 提示保存成功', async () => {
    const message = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
    ;(window as unknown as { $message: unknown }).$message = message
    mockLoad.mockResolvedValue(false)
    // 提交体即本用例写入缓存的值（模拟 WS 已把本次提交同步进共享缓存）
    mockGetConfig.mockImplementation(() => mockSave.mock.calls[0]?.[2])

    mountModal({
      visible: true,
      roomId: 'room-1',
      account: 'hula_g1',
      aiclawItems: [{ uid: '1001', name: 'OpenCode Bot', adapterType: 'opencode' }]
    })
    await flushPromises()

    ;(document.querySelector('[data-testid="aiclaw-group-config-save"]') as HTMLElement | null)?.click()
    await flushPromises()

    expect(message.success).toHaveBeenCalledWith('配置已保存')
    expect(message.warning).not.toHaveBeenCalled()
    delete (window as unknown as { $message?: unknown }).$message
  })

  // #457 A10：保存在途时目标成员变了（弹窗重载）→ 旧保存结果不得铺列表、不得发过时完成提示
  it('A10：保存在途时目标成员变化 → 不铺旧结果、不发过时完成提示', async () => {
    const message = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
    ;(window as unknown as { $message: unknown }).$message = message
    let resolveSave!: () => void
    mockSave.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSave = resolve
      })
    )

    const wrapper = mountModal({
      visible: true,
      roomId: 'room-1',
      account: 'hula_g1',
      aiclawItems: [{ uid: '1001', name: 'OpenCode Bot', adapterType: 'opencode' }]
    })
    await flushPromises()

    ;(document.querySelector('[data-testid="aiclaw-group-config-save"]') as HTMLElement | null)?.click()
    await flushPromises()
    expect(mockSave).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ aiclawItems: [{ uid: '1002', name: 'OpenClaw Bot', adapterType: 'openclaw' }] })
    await flushPromises()

    resolveSave()
    await flushPromises()

    expect(message.success).not.toHaveBeenCalled()
    expect(message.warning).not.toHaveBeenCalled()
    delete (window as unknown as { $message?: unknown }).$message
  })
})
