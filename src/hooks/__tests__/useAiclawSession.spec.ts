import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const mockFns = vi.hoisted(() => ({
  isAiclaw: vi.fn(() => false),
  isAiclawByUserType: vi.fn<(userType: number) => boolean>(() => false)
}))

const mockCurrentSession = ref<any>(null)
const mockCurrentSessionRoomId = ref('')
const mockIsGroup = ref(false)
const mockGroupMembers = ref<Array<{ uid: string; userType?: number }>>([])

vi.mock('@/utils/AiclawUtils', () => ({
  isAiclaw: mockFns.isAiclaw,
  isAiclawByUserType: mockFns.isAiclawByUserType
}))

vi.mock('@/stores/global', () => ({
  useGlobalStore: vi.fn(() => ({
    currentSession: mockCurrentSession.value,
    currentSessionRoomId: mockCurrentSessionRoomId.value
  }))
}))
vi.mock('@/stores/chat', () => ({
  useChatStore: vi.fn(() => ({
    isGroup: mockIsGroup.value
  }))
}))
vi.mock('@/stores/group', () => ({
  useGroupStore: vi.fn(() => ({
    getUserListByRoomId: () => mockGroupMembers.value
  }))
}))

import { useAiclawSession } from '@/hooks/useAiclawSession'

describe('useAiclawSession', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockFns.isAiclaw.mockReset().mockReturnValue(false)
    mockFns.isAiclawByUserType.mockReset().mockReturnValue(false)
    mockCurrentSession.value = null
    mockCurrentSessionRoomId.value = ''
    mockIsGroup.value = false
    mockGroupMembers.value = []
  })

  const setPrivateSession = (detailId: string, isAiclawValue: boolean) => {
    mockCurrentSession.value = { type: 1, detailId }
    mockCurrentSessionRoomId.value = `room-${detailId}`
    mockIsGroup.value = false
    mockFns.isAiclaw.mockReturnValue(isAiclawValue)
  }

  const setGroupSession = (roomId: string, members: Array<{ uid: string; userType?: number }> = []) => {
    mockCurrentSession.value = { type: 2, detailId: roomId }
    mockCurrentSessionRoomId.value = roomId
    mockIsGroup.value = true
    mockGroupMembers.value = members
  }

  it('私聊 aiclaw：isAiclawPrivateSession=true, allowedUploadTypes=["image","file"], headerMode=aiclaw', () => {
    setPrivateSession('2001', true)
    const session = useAiclawSession()
    expect(session.isAiclawPrivateSession.value).toBe(true)
    expect(session.allowedUploadTypes.value).toEqual(['image', 'file'])
    expect(session.disableComposer.value).toBe(false)
    expect(session.headerMode.value).toBe('aiclaw')
  })

  it('普通私聊：isAiclawPrivateSession=false, allowedUploadTypes=null, headerMode=normal', () => {
    setPrivateSession('1001', false)
    const session = useAiclawSession()
    expect(session.isAiclawPrivateSession.value).toBe(false)
    expect(session.allowedUploadTypes.value).toBeNull()
    expect(session.disableComposer.value).toBe(false)
    expect(session.headerMode.value).toBe('normal')
  })

  it('群聊不是私聊 aiclaw 会话，allowedUploadTypes=null', () => {
    setGroupSession('room-g1')
    const session = useAiclawSession()
    expect(session.isAiclawPrivateSession.value).toBe(false)
    expect(session.allowedUploadTypes.value).toBeNull()
    expect(session.disableComposer.value).toBe(false)
    expect(session.headerMode.value).toBe('normal')
  })

  describe('allowedUploadTypes 语义（P1-4）', () => {
    it('1:1 私聊 aiclaw 返回 ["image","file"]，不含 voice', () => {
      setPrivateSession('2001', true)
      const session = useAiclawSession()
      expect(session.allowedUploadTypes.value).toEqual(['image', 'file'])
      expect(session.allowedUploadTypes.value).not.toContain('voice')
    })

    it('普通私聊返回 null（表示不限）', () => {
      setPrivateSession('1001', false)
      const session = useAiclawSession()
      expect(session.allowedUploadTypes.value).toBeNull()
    })

    it('群聊返回 null（表示不限）', () => {
      setGroupSession('room-g1', [{ uid: '2001', userType: 4 }])
      const session = useAiclawSession()
      expect(session.allowedUploadTypes.value).toBeNull()
    })

    it('显式断言不会返回空数组 [] 表"不限"', () => {
      setPrivateSession('1001', false)
      const session = useAiclawSession()
      expect(session.allowedUploadTypes.value).not.toEqual([])
    })
  })

  describe('roomHasAiclaw', () => {
    it('群聊无 aiclaw 成员为 false', () => {
      setGroupSession('room-g1', [{ uid: '1001', userType: 1 }])
      const session = useAiclawSession()
      expect(session.roomHasAiclaw.value).toBe(false)
    })

    it('群聊有 aiclaw 成员为 true', () => {
      mockFns.isAiclawByUserType.mockImplementation((userType) => userType === 4)
      setGroupSession('room-g1', [
        { uid: '1001', userType: 1 },
        { uid: '2001', userType: 4 }
      ])
      const session = useAiclawSession()
      expect(session.roomHasAiclaw.value).toBe(true)
    })
  })

  describe('showThinkingSwitch（REQ-014 / CONTEXT.md room-has-aiclaw 术语）', () => {
    it('aiclaw 私聊：显示开关', () => {
      setPrivateSession('2001', true)
      const session = useAiclawSession()
      expect(session.showThinkingSwitch.value).toBe(true)
    })

    it('普通私聊：不显示开关', () => {
      setPrivateSession('1001', false)
      const session = useAiclawSession()
      expect(session.showThinkingSwitch.value).toBe(false)
    })

    it('含 aiclaw 成员的群聊：显示开关', () => {
      mockFns.isAiclawByUserType.mockImplementation((userType) => userType === 4)
      setGroupSession('room-g1', [{ uid: '2001', userType: 4 }])
      const session = useAiclawSession()
      expect(session.showThinkingSwitch.value).toBe(true)
    })

    it('无 aiclaw 成员的群聊：不显示开关', () => {
      setGroupSession('room-g1', [{ uid: '1001', userType: 1 }])
      const session = useAiclawSession()
      expect(session.showThinkingSwitch.value).toBe(false)
    })
  })
})
