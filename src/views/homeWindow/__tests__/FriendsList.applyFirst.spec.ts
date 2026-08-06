import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import homeZh from '~/locales/zh-CN/home.json'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

/**
 * REQ-017 #204 A：通知面板提速——面板先行、数据后到。
 * handleApply 点击即 emit(APPLY_SHOW) 切面板（不把列表 HTTP await 在前面），
 * 数据加载收口到 ApplyList 自己 onMounted——handleApply 不得再预拉取。
 */

vi.mock('pinia', async (importOriginal) => ({
  ...(await importOriginal<typeof import('pinia')>()),
  storeToRefs: (store: unknown) => store as any
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/friendsList' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}))

const mittEmitMock = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useMitt', () => ({ useMitt: { emit: mittEmitMock, on: vi.fn(), off: vi.fn() } }))

const getApplyPageMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const contactStoreMocks = vi.hoisted(() => ({
  contactsList: [] as any[],
  getContactList: vi.fn().mockResolvedValue(undefined),
  getApplyPage: getApplyPageMock
}))
vi.mock('@/stores/contacts', () => ({
  useContactStore: () => contactStoreMocks
}))

const globalStoreMock = vi.hoisted(() => ({
  unReadMark: { newFriendUnreadCount: 3, newGroupUnreadCount: 2 }
}))
vi.mock('@/stores/global', () => ({ useGlobalStore: () => globalStoreMock }))

vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({ getUserInfo: () => undefined, groupDetails: [] })
}))
vi.mock('@/stores/feed', () => ({ useFeedStore: () => ({ unreadCount: 0 }) }))
vi.mock('@/stores/setting', () => ({ useSettingStore: () => ({ themes: { content: 'LIGHT' } }) }))
vi.mock('@/stores/userStatus', () => ({ useUserStatusStore: () => ({ stateList: [] }) }))
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
import { MittEnum } from '@/enums'

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

describe('FriendsList handleApply 面板先行（REQ-017 #204 A）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalStoreMock.unReadMark.newFriendUnreadCount = 3
    globalStoreMock.unReadMark.newGroupUnreadCount = 2
  })

  it('点击好友通知：立即 emit APPLY_SHOW，且不预拉取（getApplyPage 零调用）', async () => {
    const wrapper = mountList()
    await flushPromises()
    mittEmitMock.mockClear()

    const entry = wrapper.findAll('div').find((d) => d.text() === homeZh.friends_list.notice.friend)
    expect(entry, '好友通知入口应存在').toBeTruthy()
    await entry!.trigger('click')

    // 同步断言：点击后立刻切面板（不等任何 HTTP）
    expect(mittEmitMock).toHaveBeenCalledWith(
      MittEnum.APPLY_SHOW,
      expect.objectContaining({ context: expect.objectContaining({ type: 'apply', applyType: 'friend' }) })
    )
    // 数据加载收口 ApplyList onMounted，handleApply 不得预拉
    expect(getApplyPageMock).not.toHaveBeenCalled()
    // 未读清零仍即时生效
    expect(globalStoreMock.unReadMark.newFriendUnreadCount).toBe(0)
  })

  it('点击群通知：立即 emit APPLY_SHOW(group)，未读清零，不预拉取', async () => {
    const wrapper = mountList()
    await flushPromises()
    mittEmitMock.mockClear()

    const entry = wrapper.findAll('div').find((d) => d.text() === homeZh.friends_list.notice.group)
    expect(entry, '群通知入口应存在').toBeTruthy()
    await entry!.trigger('click')

    expect(mittEmitMock).toHaveBeenCalledWith(
      MittEnum.APPLY_SHOW,
      expect.objectContaining({ context: expect.objectContaining({ type: 'apply', applyType: 'group' }) })
    )
    expect(getApplyPageMock).not.toHaveBeenCalled()
    expect(globalStoreMock.unReadMark.newGroupUnreadCount).toBe(0)
  })
})
