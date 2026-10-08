import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import homeZh from '~/locales/zh-CN/home.json'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'
import { MittEnum, RoomTypeEnum } from '@/enums'

/**
 * #341：好友列表主点击直进私聊——普通/aiclaw 好友走 openMsgSession，
 * 群与系统 bot 保留既有 DETAILS_SHOW 资料态。
 */

vi.mock('pinia', async (importOriginal) => ({
  ...(await importOriginal<typeof import('pinia')>()),
  storeToRefs: (store: unknown) => store as any
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/friendsList' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}))

const contactStoreMocks = vi.hoisted(() => ({
  contactsList: [] as any[],
  getContactList: vi.fn().mockResolvedValue(undefined)
}))

const userMap = vi.hoisted(() => ({ current: new Map<string, any>() }))

vi.mock('@/stores/contacts', () => ({
  useContactStore: () => contactStoreMocks
}))

vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    getUserInfo: (uid: string) => userMap.current.get(String(uid)),
    groupDetails: [{ roomId: 'room-g1', groupName: '测试群', avatar: '', remark: '' }]
  })
}))

vi.mock('@/stores/feed', () => ({ useFeedStore: () => ({ unreadCount: 0 }) }))
vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({ unReadMark: { newFriendUnreadCount: 0, newGroupUnreadCount: 0 } })
}))
vi.mock('@/stores/setting', () => ({ useSettingStore: () => ({ themes: { content: 'LIGHT' } }) }))
vi.mock('@/stores/userStatus', () => ({ useUserStatusStore: () => ({ stateList: [] }) }))

const mittEmitMock = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useMitt', () => ({
  useMitt: { emit: mittEmitMock, on: vi.fn(), off: vi.fn() }
}))

const openMsgSessionMock = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('@/hooks/useCommon', () => ({
  useCommon: () => ({ openMsgSession: openMsgSessionMock })
}))

vi.mock('@/utils/ImRequestUtils', () => ({ getUserByIds: vi.fn().mockResolvedValue([]) }))
vi.mock('@/utils/UnreadCountManager', () => ({
  unreadCountManager: {
    refreshBadge: vi.fn(),
    calculateTotal: vi.fn(),
    setUpdateCallback: vi.fn(),
    requestUpdate: vi.fn()
  }
}))

import FriendsList from '@/views/homeWindow/FriendsList.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': { home: homeZh, aiclaw: aiclawZh } }
})

const mountList = () =>
  mount(FriendsList, {
    global: {
      plugins: [i18n],
      stubs: {
        ContextMenu: { template: '<div><slot /></div>' }
      }
    }
  })

describe('FriendsList 好友主点击直进私聊（#341）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    contactStoreMocks.contactsList = [
      { uid: '1001', userType: 1, activeStatus: 1, remark: '' },
      { uid: '1002', userType: 4, activeStatus: 1, remark: '' },
      { uid: 'bot-uid', userType: 2, activeStatus: 1, remark: '' }
    ]
    userMap.current = new Map([
      ['1001', { uid: '1001', name: '普通好友', avatar: '', account: 'normal1' }],
      ['1002', { uid: '1002', name: 'AI助理', avatar: '', account: 'aiclaw1' }],
      ['bot-uid', { uid: 'bot-uid', name: 'HuLa小管家', avatar: '', account: 'bot' }]
    ])
  })

  it('普通好友主点击直进私聊，不弹资料态', async () => {
    const wrapper = mountList()
    await flushPromises()

    const items = wrapper.findAll('.item-box')
    // 好友按排序 bot 置顶，普通好友在 aiclaw 之后；按 data 定位更稳：直接调点击处理
    await (wrapper.vm as any).handleClick?.('1001', RoomTypeEnum.SINGLE)
    expect(openMsgSessionMock).toHaveBeenCalledWith('1001', RoomTypeEnum.SINGLE)
    expect(mittEmitMock).not.toHaveBeenCalledWith(MittEnum.DETAILS_SHOW, expect.objectContaining({ detailsShow: true }))
    expect(items.length).toBeGreaterThan(0)
  })

  it('aiclaw 好友主点击同样直进私聊', async () => {
    const wrapper = mountList()
    await flushPromises()

    await (wrapper.vm as any).handleClick?.('1002', RoomTypeEnum.SINGLE)
    expect(openMsgSessionMock).toHaveBeenCalledWith('1002', RoomTypeEnum.SINGLE)
  })

  it('系统 bot 保留既有资料态，不进私聊', async () => {
    const wrapper = mountList()
    await flushPromises()

    await (wrapper.vm as any).handleClick?.('bot-uid', RoomTypeEnum.SINGLE)
    expect(openMsgSessionMock).not.toHaveBeenCalled()
    expect(mittEmitMock).toHaveBeenCalledWith(MittEnum.DETAILS_SHOW, expect.objectContaining({ detailsShow: true }))
  })

  it('群列表保留既有资料态', async () => {
    const wrapper = mountList()
    await flushPromises()

    await (wrapper.vm as any).handleClick?.('room-g1', RoomTypeEnum.GROUP)
    expect(openMsgSessionMock).not.toHaveBeenCalled()
    expect(mittEmitMock).toHaveBeenCalledWith(MittEnum.DETAILS_SHOW, expect.objectContaining({ detailsShow: true }))
  })
})
