import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import mcsZh from '~/locales/zh-CN/mobile_chat_setting.json'

/**
 * REQ-017 #197：好友备注允许提交空串（清空 = 恢复显昵称）。
 * 根因修复：备注/群昵称 n-input 裸 v-model（modelValue 通道）在 naive-ui 上不生效，
 * 改 v-model:value 后输入框才回显/回写——否则清空动作根本不会触发提交。
 * 本 spec 用真实 n-input + 单聊会话场景锁定：
 *   1. 初始备注回显；2. 清空 → blur → 提交空串；3. 提交后本地 remark 置空 + 成功 toast；
 *   4. 空→空（未变化）不发请求。
 */

vi.mock('naive-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('naive-ui')>()),
  useDialog: () => ({ warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

const messageMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))

const modifyFriendRemarkMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/utils/ImRequestUtils', () => ({
  deleteFriend: vi.fn(),
  getGroupDetail: vi.fn(),
  modifyFriendRemark: modifyFriendRemarkMock,
  notification: vi.fn(),
  setSessionTop: vi.fn(),
  shield: vi.fn(),
  updateRoomInfo: vi.fn()
}))

// storeToRefs 只挑 ref/reactive 属性：currentSessionRoomId / currentSession 必须给真 ref，
// 组件脚本里的 activeItem.value / currentSessionRoomId.value 才能取到值（More.spec.ts 同款先例）
vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({
    currentSessionRoomId: ref('room-1'),
    currentSession: ref({
      type: 2, // RoomTypeEnum.SINGLE
      roomId: 'room-1',
      detailId: 'u2',
      muteNotification: 0,
      top: false,
      shield: false
    }),
    updateCurrentSessionRoomId: vi.fn()
  })
}))

const contactsMock = vi.hoisted(() => ({
  contactsList: [{ uid: 'u2', remark: '小安', name: '安洁', activeStatus: 1 }] as any[]
}))
vi.mock('@/stores/contacts.ts', () => ({ useContactStore: () => contactsMock }))

vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    userList: [],
    memberList: [],
    countInfo: null,
    myNameInCurrentGroup: '',
    isAdminOrLord: () => false,
    getUserInfo: () => undefined,
    getUserListByRoomId: () => []
  })
}))
vi.mock('@/stores/cached', () => ({
  useCachedStore: () => ({ getGroupAnnouncementList: vi.fn().mockResolvedValue(null) })
}))
vi.mock('@/stores/chat.ts', () => ({
  useChatStore: () => ({ updateSession: vi.fn(), updateTotalUnreadCount: vi.fn(), isGroup: false })
}))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ userInfo: { uid: 'me' } }) }))

vi.mock('@/hooks/useAiclawSession', () => ({
  useAiclawSession: () => ({ isAiclawPrivateSession: ref(false) })
}))
vi.mock('@/hooks/useMyRoomInfoUpdater', () => ({
  useMyRoomInfoUpdater: () => ({ persistMyRoomInfo: vi.fn() })
}))
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

describe('ChatSetting 单聊备注清空（REQ-017 #197）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).$message = messageMock
    contactsMock.contactsList = [{ uid: 'u2', remark: '小安', name: '安洁', activeStatus: 1 }]
  })

  const findRemarkInput = (wrapper: ReturnType<typeof mountSetting>) => {
    // 备注输入框：placeholder = 该名称仅自己可见（mobile_chat_setting.input.remark）
    const inputs = wrapper.findAll('input')
    const remarkEl = inputs.find((el) => el.attributes('placeholder') === mcsZh.input.remark)
    expect(
      remarkEl,
      `remark input 应存在（现有 inputs: ${inputs.map((i) => i.attributes('placeholder')).join(',')}）`
    ).toBeTruthy()
    return remarkEl!
  }

  it('初始备注回显在输入框（v-model:value 修复后）', async () => {
    const wrapper = mountSetting()
    await flushPromises()

    const remarkEl = findRemarkInput(wrapper)
    expect((remarkEl.element as HTMLInputElement).value).toBe('小安')
  })

  it('清空备注 → blur 提交空串，本地 remark 置空并提示成功', async () => {
    const wrapper = mountSetting()
    await flushPromises()

    const remarkEl = findRemarkInput(wrapper)
    await remarkEl.setValue('')
    await remarkEl.trigger('blur')
    await flushPromises()

    expect(modifyFriendRemarkMock).toHaveBeenCalledWith({ targetUid: 'u2', remark: '' })
    expect(contactsMock.contactsList[0].remark).toBe('')
    expect(messageMock.success).toHaveBeenCalled()
    expect(messageMock.error).not.toHaveBeenCalled()
  })

  it('修改备注（非空）正常提交', async () => {
    const wrapper = mountSetting()
    await flushPromises()

    const remarkEl = findRemarkInput(wrapper)
    await remarkEl.setValue('安总')
    await remarkEl.trigger('blur')
    await flushPromises()

    expect(modifyFriendRemarkMock).toHaveBeenCalledWith({ targetUid: 'u2', remark: '安总' })
    expect(contactsMock.contactsList[0].remark).toBe('安总')
  })

  it('备注无变化（值未改）不发请求', async () => {
    const wrapper = mountSetting()
    await flushPromises()

    const remarkEl = findRemarkInput(wrapper)
    await remarkEl.trigger('blur')
    await flushPromises()

    expect(modifyFriendRemarkMock).not.toHaveBeenCalled()
  })
})
