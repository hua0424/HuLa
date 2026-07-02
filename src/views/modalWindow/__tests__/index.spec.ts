import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import ModalInviteWindow from '@/views/modalWindow/index.vue'

const mocks = vi.hoisted(() => ({
  getContactList: vi.fn().mockResolvedValue(undefined),
  getGroupUserList: vi.fn().mockResolvedValue(undefined),
  inviteGroupMember: vi.fn().mockResolvedValue(undefined),
  getWindowPayload: vi.fn().mockResolvedValue({ roomId: 'room-1', type: 1 }),
  emit: vi.fn(),
  show: vi.fn().mockResolvedValue(undefined),
  title: vi.fn().mockResolvedValue('邀请进群')
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({})
}))

vi.mock('colorthief', () => ({
  default: class {
    getColor() {
      return Promise.resolve([0, 0, 0])
    }
  }
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({}),
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('@/router', () => ({
  default: {}
}))

vi.mock('@/services/fingerprint', () => ({
  getFingerprint: vi.fn().mockResolvedValue('mock-fingerprint')
}))

vi.mock('@/hooks/useMitt', () => ({
  useMitt: () => ({ emit: mocks.emit, on: vi.fn() })
}))

vi.mock('@/hooks/useWindow', () => ({
  useWindow: () => ({ getWindowPayload: mocks.getWindowPayload })
}))

vi.mock('@/stores/contacts', () => ({
  useContactStore: () => ({
    contactsList: [
      { uid: '1001', remark: 'Alice' },
      { uid: '1002', remark: 'Bob' }
    ],
    getContactList: mocks.getContactList
  })
}))

vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({
    currentSessionRoomId: 'room-1'
  })
}))

vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    getGroupUserList: mocks.getGroupUserList,
    getUserInfo: (uid: string) => ({ name: `User-${uid}` })
  })
}))

vi.mock('@/layout/center/model.tsx', () => ({
  getDisabledOptions: vi.fn().mockReturnValue([]),
  getFilteredOptions: vi.fn().mockReturnValue([
    { label: 'Alice', value: '1001', avatar: '' },
    { label: 'Bob', value: '1002', avatar: '' }
  ]),
  renderSourceList: vi.fn(() => () => null),
  renderLabel: vi.fn(() => null)
}))

vi.mock('@/utils/ImRequestUtils', () => ({
  inviteGroupMember: mocks.inviteGroupMember
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getCurrent: () => ({ label: 'modal-invite' }) },
  getCurrentWebviewWindow: () => ({
    label: 'modal-invite',
    show: mocks.show,
    title: mocks.title
  })
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': {
      'home.chat_header.modal.confirm': '确认',
      'home.chat_header.modal.cancel': '取消'
    }
  }
})

const mountWindow = () =>
  mount(ModalInviteWindow, {
    global: {
      plugins: [i18n],
      stubs: {
        ActionBar: true,
        NTransfer: true,
        NButton: true,
        NFlex: true
      }
    }
  })

describe('#121 modal-invite 弹窗好友列表水合', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('打开弹窗时应主动刷新联系人列表', async () => {
    mountWindow()
    await flushPromises()

    expect(mocks.getContactList).toHaveBeenCalledWith(true)
  })

  it('应使用父窗口传入的 roomId 初始化群成员', async () => {
    mountWindow()
    await flushPromises()

    expect(mocks.getWindowPayload).toHaveBeenCalledWith('modal-invite')
    expect(mocks.getGroupUserList).toHaveBeenCalledWith('room-1')
  })
})
