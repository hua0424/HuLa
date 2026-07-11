import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'

/**
 * REQ-009 #86 / #174：useSilentAiclaw 单一事实源的单元测试。
 * 覆盖三条判据：
 * - approved=false 的 aiclaw → isSilentMember 为 true（渲染沉默标识）
 * - approved=true / undefined / 非 aiclaw → false（不渲染，避免 unloaded 误标）
 * - 进入群 / 成员变化时 autoWatch 拉取全群 aiclaw 的 approved（组件归属修复的拉取侧）
 */

const mockGetUserInfo = vi.fn()
const mockGetAiclawGroupConfig = vi.fn()
const mockLoadAiclawGroupConfig = vi.fn().mockResolvedValue(true)

const globalState = reactive<{ currentSessionRoomId: string }>({ currentSessionRoomId: '' })
const chatState = reactive<{ isGroup: boolean }>({ isGroup: false })
const groupUserList = ref<Array<{ uid: string; userType?: number }>>([])
const AICLAW = UserType.AICLAW as number

vi.mock('@/stores/chat', () => ({
  useChatStore: vi.fn(() => ({
    get isGroup() {
      return chatState.isGroup
    },
    getAiclawGroupConfig: mockGetAiclawGroupConfig,
    loadAiclawGroupConfig: mockLoadAiclawGroupConfig
  }))
}))
vi.mock('@/stores/global', () => ({
  useGlobalStore: vi.fn(() => ({
    get currentSessionRoomId() {
      return globalState.currentSessionRoomId
    }
  }))
}))
vi.mock('@/stores/group', () => ({
  useGroupStore: vi.fn(() => ({
    getUserInfo: mockGetUserInfo,
    get userList() {
      return groupUserList.value
    }
  }))
}))

import { UserType } from '@/enums'
import { useSilentAiclaw } from '@/hooks/useSilentAiclaw'

describe('useSilentAiclaw', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockGetUserInfo.mockReset()
    mockGetAiclawGroupConfig.mockReset()
    mockLoadAiclawGroupConfig.mockClear()
    globalState.currentSessionRoomId = ''
    chatState.isGroup = false
    groupUserList.value = []
  })

  describe('isSilentMember', () => {
    it('approved=false 的 aiclaw 成员 → true', () => {
      globalState.currentSessionRoomId = '100'
      mockGetUserInfo.mockReturnValue({ uid: '1', userType: UserType.AICLAW })
      mockGetAiclawGroupConfig.mockReturnValue({ approved: false })
      const { isSilentMember } = useSilentAiclaw({ autoWatch: false })
      expect(isSilentMember('1')).toBe(true)
    })

    it('approved=true 的 aiclaw 成员 → false', () => {
      globalState.currentSessionRoomId = '100'
      mockGetUserInfo.mockReturnValue({ uid: '1', userType: UserType.AICLAW })
      mockGetAiclawGroupConfig.mockReturnValue({ approved: true })
      const { isSilentMember } = useSilentAiclaw({ autoWatch: false })
      expect(isSilentMember('1')).toBe(false)
    })

    it('approved 尚未加载（undefined）→ false，避免 unloaded 误标', () => {
      globalState.currentSessionRoomId = '100'
      mockGetUserInfo.mockReturnValue({ uid: '1', userType: UserType.AICLAW })
      mockGetAiclawGroupConfig.mockReturnValue(undefined)
      const { isSilentMember } = useSilentAiclaw({ autoWatch: false })
      expect(isSilentMember('1')).toBe(false)
    })

    it('非 aiclaw 成员即便 approved=false 也不标识', () => {
      globalState.currentSessionRoomId = '100'
      mockGetUserInfo.mockReturnValue({ uid: '1', userType: 1 })
      mockGetAiclawGroupConfig.mockReturnValue({ approved: false })
      const { isSilentMember } = useSilentAiclaw({ autoWatch: false })
      expect(isSilentMember('1')).toBe(false)
    })

    it('无当前房间 / 无用户信息 → false', () => {
      const { isSilentMember } = useSilentAiclaw({ autoWatch: false })
      // 无 roomId
      mockGetUserInfo.mockReturnValue({ uid: '1', userType: UserType.AICLAW })
      expect(isSilentMember('1')).toBe(false)
      // 有 roomId 但无用户信息
      globalState.currentSessionRoomId = '100'
      mockGetUserInfo.mockReturnValue(undefined)
      expect(isSilentMember('1')).toBe(false)
    })
  })

  describe('loadSilentConfigsForCurrentRoom', () => {
    it('只为群内 aiclaw 成员逐一拉取 approved', async () => {
      globalState.currentSessionRoomId = '100'
      groupUserList.value = [
        { uid: '1', userType: AICLAW },
        { uid: '2', userType: 1 },
        { uid: '3', userType: AICLAW }
      ]
      const { loadSilentConfigsForCurrentRoom } = useSilentAiclaw({ autoWatch: false })
      await loadSilentConfigsForCurrentRoom()
      expect(mockLoadAiclawGroupConfig).toHaveBeenCalledTimes(2)
      expect(mockLoadAiclawGroupConfig).toHaveBeenCalledWith(1, '100')
      expect(mockLoadAiclawGroupConfig).toHaveBeenCalledWith(3, '100')
    })

    it('无当前房间时不拉取', async () => {
      groupUserList.value = [{ uid: '1', userType: AICLAW }]
      const { loadSilentConfigsForCurrentRoom } = useSilentAiclaw({ autoWatch: false })
      await loadSilentConfigsForCurrentRoom()
      expect(mockLoadAiclawGroupConfig).not.toHaveBeenCalled()
    })
  })

  describe('autoWatch', () => {
    it('进入群聊（roomId + isGroup 就绪）后自动拉取', async () => {
      useSilentAiclaw({ autoWatch: true })
      // immediate 首次：roomId 空，不拉
      await nextTick()
      expect(mockLoadAiclawGroupConfig).not.toHaveBeenCalled()

      // 进群 + 成员就绪
      groupUserList.value = [{ uid: '1', userType: AICLAW }]
      globalState.currentSessionRoomId = '100'
      chatState.isGroup = true
      await nextTick()
      expect(mockLoadAiclawGroupConfig).toHaveBeenCalledWith(1, '100')
    })
  })
})
