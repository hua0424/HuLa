import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { createI18n, useI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'
import homeZh from '~/locales/zh-CN/home.json'
import menuZh from '~/locales/zh-CN/menu.json'

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(),
  join: vi.fn(),
  resourceDir: vi.fn()
}))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeImage: vi.fn(),
  writeText: vi.fn()
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ BaseDirectory: {} }))
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }))

vi.mock('@/utils/PlatformConstants', () => ({
  isMac: vi.fn(() => false),
  isMobile: vi.fn(() => false),
  isWeb: vi.fn(() => false),
  isWindows: vi.fn(() => true)
}))
vi.mock('@/utils/TauriInvokeHandler', () => ({ invokeWithErrorHandler: vi.fn() }))
vi.mock('@/services/translate', () => ({ translateTextStream: vi.fn() }))
vi.mock('@/utils/AttachmentSaver', () => ({
  saveFileAttachmentAs: vi.fn(),
  saveVideoAttachmentAs: vi.fn()
}))
vi.mock('@/utils/ImRequestUtils', () => ({
  recallMsg: vi.fn(),
  removeGroupMember: vi.fn(),
  updateMyRoomInfo: vi.fn(),
  imRequestSilent: vi.fn()
}))
vi.mock('@/utils/ImageUtils', () => ({
  detectImageFormat: vi.fn(),
  imageUrlToUint8Array: vi.fn(),
  isImageUrl: vi.fn()
}))
vi.mock('@/utils/PathUtil', () => ({
  detectRemoteFileType: vi.fn(),
  getFilesMeta: vi.fn()
}))

vi.mock('@/hooks/useCommon', () => ({
  useCommon: vi.fn(() => ({ openMsgSession: vi.fn(), userUid: ref('1000') }))
}))
vi.mock('@/hooks/useWindow', () => ({
  useWindow: vi.fn(() => ({
    createWebviewWindow: vi.fn(),
    sendWindowPayload: vi.fn(),
    startRtcCall: vi.fn()
  }))
}))
vi.mock('@/hooks/useDownload', () => ({
  useDownload: vi.fn(() => ({ downloadFile: vi.fn() }))
}))
vi.mock('@/hooks/useVideoViewer', () => ({
  useVideoViewer: vi.fn(() => ({
    getLocalVideoPath: vi.fn(),
    checkVideoDownloaded: vi.fn()
  }))
}))
vi.mock('@/hooks/useMitt', () => ({
  useMitt: { on: vi.fn(), emit: vi.fn() }
}))

const mockFns = vi.hoisted(() => ({
  isMyAiclaw: vi.fn(() => false),
  openModal: vi.fn()
}))

vi.mock('@/stores/aiclaw', () => ({
  useAiclawStore: vi.fn(() => ({ isMyAiclaw: mockFns.isMyAiclaw, loaded: false, ensureLoaded: vi.fn() }))
}))
vi.mock('@/stores/aiclawGroupConfig', () => ({
  useAiclawGroupConfigStore: vi.fn(() => ({ openModal: mockFns.openModal }))
}))
vi.mock('@/stores/cached', () => ({ useCachedStore: vi.fn(() => ({})) }))
vi.mock('@/stores/chat', () => ({
  useChatStore: vi.fn(() => ({
    chatMessageList: [],
    isGroup: false,
    clearMsgCheck: vi.fn(),
    setMsgMultiChoose: vi.fn(),
    recordRecallMsg: vi.fn(),
    updateRecallMsg: vi.fn()
  }))
}))
vi.mock('@/stores/contacts', () => ({ useContactStore: vi.fn(() => ({})) }))
vi.mock('@/stores/emoji', () => ({ useEmojiStore: vi.fn(() => ({ addEmoji: vi.fn() })) }))
vi.mock('@/stores/fileDownload', () => ({ useFileDownloadStore: vi.fn(() => ({})) }))
vi.mock('@/stores/global', () => ({
  useGlobalStore: vi.fn(() => ({
    currentSessionRoomId: 'room-1',
    currentSession: { type: 1 }
  }))
}))
vi.mock('@/stores/group', () => ({
  useGroupStore: vi.fn(() => ({
    userList: [],
    countInfo: {},
    updateUserItem: vi.fn(),
    updateGroupDetail: vi.fn()
  }))
}))
vi.mock('@/stores/setting', () => ({
  useSettingStore: vi.fn(() => ({ chat: ref({}) }))
}))
vi.mock('@/stores/user', () => ({
  useUserStore: vi.fn(() => ({ userInfo: { uid: '1000' } }))
}))

import { useChatMain } from '@/hooks/useChatMain.ts'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': {
      aiclaw: aiclawZh,
      home: homeZh,
      menu: menuZh
    }
  }
})

const TestComponent = defineComponent({
  setup() {
    useI18n()
    const ctx = useChatMain(false, { enableGroupNicknameModal: false })
    return { ctx }
  },
  template: '<div />'
})

const mountHook = () => {
  setActivePinia(createPinia())
  return mount(TestComponent, {
    global: {
      plugins: [i18n]
    }
  })
}

describe('useChatMain aiclaw 群设置入口', () => {
  beforeEach(() => {
    mockFns.isMyAiclaw.mockReturnValue(false)
    mockFns.openModal.mockReset()
  })

  it('optionsList 中包含「群设置」菜单项且携带 testid', () => {
    const wrapper = mountHook()
    const item = wrapper.vm.ctx.optionsList.value.find((it: any) => it?.testid === 'aiclaw-group-settings-menu')
    expect(item).toBeTruthy()
  })

  it('目标用户为当前用户所有的 aiclaw 时，菜单项可见', () => {
    mockFns.isMyAiclaw.mockReturnValue(true)

    const wrapper = mountHook()
    const item = wrapper.vm.ctx.optionsList.value.find((it: any) => it?.testid === 'aiclaw-group-settings-menu')
    expect(item!.visible!({ uid: '2001' })).toBe(true)
  })

  it('目标用户不是当前用户所有时，菜单项不可见', () => {
    mockFns.isMyAiclaw.mockReturnValue(false)

    const wrapper = mountHook()
    const item = wrapper.vm.ctx.optionsList.value.find((it: any) => it?.testid === 'aiclaw-group-settings-menu')
    expect(item!.visible!({ uid: '2001' })).toBe(false)
  })

  it('点击「群设置」菜单项时调用 aiclawGroupConfigStore.openModal', async () => {
    mockFns.isMyAiclaw.mockReturnValue(true)

    const wrapper = mountHook()
    const item = wrapper.vm.ctx.optionsList.value.find((it: any) => it?.testid === 'aiclaw-group-settings-menu')
    item!.click!({ uid: '2001' })

    expect(mockFns.openModal).toHaveBeenCalledWith('2001')
  })

  it('菜单项无 uid 时不调用 aiclawGroupConfigStore.openModal', () => {
    mockFns.isMyAiclaw.mockReturnValue(true)

    const wrapper = mountHook()
    const item = wrapper.vm.ctx.optionsList.value.find((it: any) => it?.testid === 'aiclaw-group-settings-menu')
    item!.click!({})

    expect(mockFns.openModal).not.toHaveBeenCalled()
  })
})
