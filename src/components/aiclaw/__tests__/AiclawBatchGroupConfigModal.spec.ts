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
const mockGetList = vi.fn()
const mockSave = vi.fn()
const mockAddGroupDetail = vi.fn()
const mockGetGroupDetail = vi.fn()

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    loadAiclawGroupConfigs: mockLoad,
    getAiclawGroupConfigList: mockGetList,
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
    mockGetList.mockReset()
    mockSave.mockReset()
    mockAddGroupDetail.mockReset()
    mockGetGroupDetail.mockReset()
    mockLoad.mockResolvedValue(true)
    mockGetList.mockReturnValue([])
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
})
