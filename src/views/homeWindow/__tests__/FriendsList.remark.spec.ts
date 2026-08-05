import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import homeZh from '~/locales/zh-CN/home.json'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

/**
 * REQ-016 #194 追加（manager 裁决）：好友列表显示层备注优先。
 * FriendItem.remark 非空显备注、空回退昵称（contactsList 已含 remark 字段）。
 * 桌面 FriendsList.vue 与移动 friends/index.vue 同款语义。
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
  getContactList: vi.fn()
}))
vi.mock('@/stores/contacts', () => ({
  useContactStore: () => contactStoreMocks
}))

const groupStoreMocks = vi.hoisted(() => ({
  users: new Map<string, any>(),
  groupDetails: [] as any[]
}))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    getUserInfo: (uid: string) => groupStoreMocks.users.get(String(uid)),
    groupDetails: groupStoreMocks.groupDetails
  })
}))

vi.mock('@/stores/feed', () => ({ useFeedStore: () => ({ unreadCount: 0 }) }))
vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({ unReadMark: { newFriendUnreadCount: 0, newGroupUnreadCount: 0 } })
}))
vi.mock('@/stores/setting', () => ({ useSettingStore: () => ({ themes: { content: 'LIGHT' } }) }))
vi.mock('@/stores/userStatus', () => ({ useUserStatusStore: () => ({ stateList: [] }) }))
vi.mock('@/hooks/useMitt', () => ({ useMitt: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }))
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

describe('FriendsList 好友显示名备注优先（REQ-016 #194 追加）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    groupStoreMocks.users = new Map([['1001', { uid: '1001', name: '安洁', avatar: '', activeStatus: 1 }]])
  })

  it('remark 非空时显备注名', async () => {
    contactStoreMocks.contactsList = [{ uid: '1001', remark: '小安', activeStatus: 1 }]
    const wrapper = mountList()
    await flushPromises()

    const nameSpan = wrapper.find('.item-box span.text-14px')
    expect(nameSpan.text()).toBe('小安')
  })

  it('remark 为空时回退昵称', async () => {
    contactStoreMocks.contactsList = [{ uid: '1001', remark: '', activeStatus: 1 }]
    const wrapper = mountList()
    await flushPromises()

    const nameSpan = wrapper.find('.item-box span.text-14px')
    expect(nameSpan.text()).toBe('安洁')
  })
})
