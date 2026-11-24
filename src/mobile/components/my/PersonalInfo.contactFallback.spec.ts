import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { ImUrlEnum, OnlineEnum, UserType } from '@/enums'
import type { FriendItem, UserItem } from '@/services/types'
import personalInfoEn from '~/locales/en/mobile_personal_info.json'
import PersonalInfo from './PersonalInfo.vue'

const uid = '231631223857152'
const friend: FriendItem = {
  uid,
  name: 'New assistant',
  avatar: '',
  account: 'new-assistant',
  userType: Number(UserType.AICLAW),
  activeStatus: OnlineEnum.ONLINE,
  lastOptTime: 0,
  remark: '',
  hideMyPosts: false,
  hideTheirPosts: false
}
const contactsList: FriendItem[] = []
const allUserInfo: UserItem[] = []
const {
  imRequest,
  getSessionDetailWithFriends,
  getUserInfo,
  preloadChatRoom,
  getSessionList,
  onDeleteFriend,
  showDialog
} = vi.hoisted(() => ({
  imRequest: vi.fn(),
  getSessionDetailWithFriends: vi.fn(),
  getUserInfo: vi.fn(),
  preloadChatRoom: vi.fn(),
  getSessionList: vi.fn(),
  onDeleteFriend: vi.fn(),
  showDialog: vi.fn()
}))

vi.mock('vant', () => ({ showDialog }))
vi.mock('vant/es/dialog/style', () => ({}))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ userInfo: { uid: '1001' } }) }))
vi.mock('@/stores/userStatus', () => ({ useUserStatusStore: () => ({ stateList: ref([]), currentState: {} }) }))
vi.mock('@/stores/contacts', () => ({ useContactStore: () => ({ contactsList, onDeleteFriend }) }))
vi.mock('@/stores/group', () => ({ useGroupStore: () => ({ allUserInfo, getUserInfo }) }))
vi.mock('@/stores/global', () => ({ useGlobalStore: () => ({}) }))
vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({ getSession: () => undefined, updateSessionLastActiveTime: vi.fn(), getSessionList })
}))
vi.mock('@/hooks/useMessage.ts', () => ({ useMessage: () => ({ preloadChatRoom }) }))
vi.mock('@/utils/ImRequestUtils', () => ({ imRequest, getSessionDetailWithFriends }))

const profilePath = `/mobile/mobileFriends/friendInfo/${uid}`
const chatPath = '/mobile/chatRoom/chatMain'
const chatSelector = '[data-testid="mobile-friend-profile-chat"]'
const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { mobile_personal_info: personalInfoEn } }
})

async function mountProfile() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/mobile/mobileFriends/friendInfo/:uid', component: PersonalInfo },
      { path: chatPath, component: { template: '<div />' } }
    ]
  })
  await router.push(profilePath)
  const wrapper = mount(PersonalInfo, { props: { isMyPage: false }, global: { plugins: [router, i18n] } })
  await flushPromises()
  return { wrapper, router }
}

describe('mobile friend profile with no shared group', () => {
  beforeEach(() => {
    contactsList.splice(0, contactsList.length, friend)
    allUserInfo.length = 0
    vi.resetAllMocks()
    imRequest.mockRejectedValue(new Error('Optional owner details unavailable'))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('keeps the raw contact fallback out of the Remove action after confirmation', async () => {
    const warning = vi.fn()
    vi.stubGlobal('$message', { warning, success: vi.fn() })
    showDialog.mockResolvedValue('confirm')
    const { wrapper } = await mountProfile()

    expect(wrapper.text()).toContain(friend.name)
    const remove = wrapper.findAll('button').find((button) => button.text() === personalInfoEn.remove_user)
    expect(remove).toBeDefined()
    await remove?.trigger('click')
    await flushPromises()
    expect(showDialog).toHaveBeenCalledTimes(1)
    expect(onDeleteFriend).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledExactlyOnceWith(personalInfoEn.not_found)
    wrapper.unmount()
  })

  it('renders the exact assistant contact and opens its normal Chat when the optional profile read fails', async () => {
    getSessionDetailWithFriends.mockResolvedValue({ roomId: '3001' })
    const { wrapper, router } = await mountProfile()

    expect(imRequest).toHaveBeenCalledExactlyOnceWith({ url: ImUrlEnum.GET_USER_BY_ID, params: { id: uid } })
    expect(wrapper.text()).toContain(friend.name)
    expect(wrapper.text()).toContain(`ID:${friend.account}`)
    const chat = wrapper.get(chatSelector)
    expect(chat.text()).toBe(personalInfoEn.chat)
    expect(chat.attributes('aria-label')).toBe(personalInfoEn.chat)
    expect(wrapper.text()).not.toContain(personalInfoEn.open_bot)
    expect(wrapper.text()).not.toContain(personalInfoEn.add_friend)

    await chat.trigger('click')
    await flushPromises()
    expect(getSessionDetailWithFriends).toHaveBeenCalledExactlyOnceWith({ id: uid, roomType: 2 })
    expect(getSessionList).toHaveBeenCalledExactlyOnceWith(true)
    expect(preloadChatRoom).toHaveBeenCalledExactlyOnceWith('3001')
    expect(router.currentRoute.value.path).toBe(chatPath)
    wrapper.unmount()
  })

  it('keeps Chat and uses the separate friend cache when no group profile exists', async () => {
    const cachedFriend = { ...friend, name: 'Assistant from friend cache', account: 'cached-assistant' }
    getUserInfo.mockImplementation((key: string) => (key === uid ? cachedFriend : undefined))
    const { wrapper } = await mountProfile()

    expect(wrapper.text()).toContain(cachedFriend.name)
    expect(wrapper.text()).toContain(`ID:${cachedFriend.account}`)
    expect(wrapper.text()).not.toContain(friend.name)
    expect(wrapper.get(chatSelector).text()).toBe(personalInfoEn.chat)
    wrapper.unmount()
  })

  it('keeps a cold ordinary contact on the old profile behavior', async () => {
    contactsList[0] = { ...friend, name: 'Ordinary contact', userType: 3 }
    const { wrapper } = await mountProfile()

    expect(wrapper.text()).not.toContain('Ordinary contact')
    expect(wrapper.get(chatSelector).text()).toBe(personalInfoEn.chat)
    expect(imRequest).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not unlock Chat or read owner details for a different assistant in contacts', async () => {
    contactsList[0] = { ...friend, uid: '231631223857153' }
    const { wrapper } = await mountProfile()

    expect(wrapper.text()).not.toContain(friend.name)
    expect(wrapper.find(chatSelector).exists()).toBe(false)
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['+\u00a0 Add friend'])
    expect(imRequest).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps cached profile details and Open Bot for an existing bot contact', async () => {
    const cachedProfile: UserItem = {
      uid,
      name: 'Cached bot profile',
      account: 'bot',
      avatar: '',
      activeStatus: OnlineEnum.ONLINE,
      lastOptTime: 0,
      userType: 2
    }
    contactsList[0] = { ...friend, userType: 2 }
    allUserInfo.push(cachedProfile)
    getUserInfo.mockReturnValue(cachedProfile)
    const { wrapper } = await mountProfile()

    expect(wrapper.text()).toContain(cachedProfile.name)
    expect(wrapper.find(chatSelector).exists()).toBe(false)
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual([personalInfoEn.open_bot])
    expect(imRequest).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
