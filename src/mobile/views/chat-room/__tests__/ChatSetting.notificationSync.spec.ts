import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import mcsZh from '~/locales/zh-CN/mobile_chat_setting.json'

/**
 * #482：移动端群名称修改只有一处反馈点。
 * updateRoomInfo 已经在内部按 notificationSync 决定“成功”或“已保存但同步未完”，
 * 页面层不得再叠加第二条 toast（历史缺陷是双成功提示）。
 */

vi.mock('naive-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('naive-ui')>()),
  useDialog: () => ({ warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

const messageMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
const updateRoomInfoMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: true, notificationSync: { state: 'INCOMPLETE' } })
)

vi.mock('@/utils/ImRequestUtils', () => ({
  deleteFriend: vi.fn(),
  getGroupDetail: vi.fn(),
  modifyFriendRemark: vi.fn(),
  notification: vi.fn(),
  setSessionTop: vi.fn(),
  shield: vi.fn(),
  updateRoomInfo: updateRoomInfoMock
}))

const session = ref({
  type: 1, // RoomTypeEnum.GROUP
  roomId: 'room-1',
  detailId: 'room-1',
  muteNotification: 0,
  top: false,
  shield: false
})

vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({
    currentSessionRoomId: ref('room-1'),
    currentSession: session,
    updateCurrentSessionRoomId: vi.fn()
  })
}))

vi.mock('@/stores/contacts.ts', () => ({ useContactStore: () => ({ contactsList: [] }) }))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    userList: [],
    memberList: [],
    countInfo: null,
    myNameInCurrentGroup: '',
    isAdminOrLord: () => true,
    getUserInfo: () => undefined,
    getUserListByRoomId: () => []
  })
}))
vi.mock('@/stores/cached', () => ({
  useCachedStore: () => ({ getGroupAnnouncementList: vi.fn().mockResolvedValue(null) })
}))
vi.mock('@/stores/chat.ts', () => ({
  useChatStore: () => ({ updateSession: vi.fn(), updateTotalUnreadCount: vi.fn(), isGroup: true })
}))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ userInfo: { uid: 'me' } }) }))
vi.mock('@/hooks/useAiclawSession', () => ({ useAiclawSession: () => ({ isAiclawPrivateSession: ref(false) }) }))
vi.mock('@/hooks/useMyRoomInfoUpdater', () => ({ useMyRoomInfoUpdater: () => ({ persistMyRoomInfo: vi.fn() }) }))
vi.mock('@/hooks/useAvatarUpload', () => ({
  useAvatarUpload: () => ({
    localImageUrl: ref(''),
    showCropper: ref(false),
    openAvatarCropper: vi.fn(),
    handleFileChange: vi.fn(),
    handleCrop: vi.fn()
  })
}))
vi.mock('@/hooks/useMitt.ts', () => ({ useMitt: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }))
vi.mock('@/router', () => ({ default: { push: vi.fn(), replace: vi.fn() } }))
vi.mock('@/utils/RouterUtils', () => ({ toFriendInfoPage: vi.fn() }))
vi.mock('@/utils/dissolveGroup', () => ({ dissolveGroupOptimistic: vi.fn() }))

import ChatSetting from '@/mobile/views/chat-room/ChatSetting.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': { mobile_chat_setting: mcsZh } }
})

const mountSetting = () =>
  mount(ChatSetting, {
    global: {
      plugins: [i18n],
      stubs: {
        AutoFixHeightPage: { template: '<div><slot name="header" /><slot name="container" /><slot /></div>' },
        HeaderBar: true,
        AvatarCropper: true,
        AiclawDeleteConfirmDialog: true,
        'n-scrollbar': { template: '<div><slot /></div>' }
      }
    }
  })

describe('#482 移动端群名称修改的单次反馈', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).$message = messageMock
    updateRoomInfoMock.mockResolvedValue({ data: true, notificationSync: { state: 'INCOMPLETE' } })
    session.value = { type: 1, roomId: 'room-1', detailId: 'room-1', muteNotification: 0, top: false, shield: false }
  })

  const nameInput = (wrapper: ReturnType<typeof mountSetting>) => {
    const inputs = wrapper.findAll('input')
    const el = inputs.find((i) => i.attributes('placeholder') === mcsZh.input.group_name)
    expect(el, '群名称输入框应存在').toBeTruthy()
    return el!
  }

  it('同步未完成时页面不再叠加成功提示（反馈只来自 updateRoomInfo）', async () => {
    const wrapper = mountSetting()
    await flushPromises()

    const input = nameInput(wrapper)
    await input.setValue('新群名')
    await input.trigger('blur')
    await flushPromises()

    expect(updateRoomInfoMock).toHaveBeenCalledWith({ id: 'room-1', name: '新群名', avatar: '' })
    expect(messageMock.success).not.toHaveBeenCalled()
    expect(messageMock.warning).not.toHaveBeenCalled()
    expect(messageMock.error).not.toHaveBeenCalled()
  })

  it('群名未变化时不发请求，也不产生任何提示', async () => {
    const wrapper = mountSetting()
    await flushPromises()

    await nameInput(wrapper).trigger('blur')
    await flushPromises()

    expect(updateRoomInfoMock).not.toHaveBeenCalled()
    expect(messageMock.success).not.toHaveBeenCalled()
  })
})
