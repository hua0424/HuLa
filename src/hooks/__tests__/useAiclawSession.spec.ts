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
const mockIsCurrentRoomThinking = ref(false)
const mockThinkingArchive = ref(new Map<string, any[]>())
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
    isGroup: mockIsGroup.value,
    isCurrentRoomThinking: mockIsCurrentRoomThinking.value,
    thinkingArchive: mockThinkingArchive.value
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
    mockIsCurrentRoomThinking.value = false
    mockThinkingArchive.value = new Map()
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

  it('私聊 aiclaw：isAiclawPrivateSession=true, disableComposer=true, headerMode=aiclaw', () => {
    setPrivateSession('2001', true)
    const session = useAiclawSession()
    expect(session.isAiclawPrivateSession.value).toBe(true)
    expect(session.disableComposer.value).toBe(true)
    expect(session.headerMode.value).toBe('aiclaw')
  })

  it('普通私聊：isAiclawPrivateSession=false, disableComposer=false, headerMode=normal', () => {
    setPrivateSession('1001', false)
    const session = useAiclawSession()
    expect(session.isAiclawPrivateSession.value).toBe(false)
    expect(session.disableComposer.value).toBe(false)
    expect(session.headerMode.value).toBe('normal')
  })

  it('群聊不是私聊 aiclaw 会话', () => {
    setGroupSession('room-g1')
    const session = useAiclawSession()
    expect(session.isAiclawPrivateSession.value).toBe(false)
    expect(session.disableComposer.value).toBe(false)
    expect(session.headerMode.value).toBe('normal')
  })

  it('showThinking：私聊 aiclaw 为 true', () => {
    setPrivateSession('2001', true)
    const session = useAiclawSession()
    expect(session.showThinking.value).toBe(true)
  })

  it('showThinking：普通私聊为 false', () => {
    setPrivateSession('1001', false)
    const session = useAiclawSession()
    expect(session.showThinking.value).toBe(false)
  })

  it('roomHasAiclaw：群聊无 aiclaw 成员为 false', () => {
    setGroupSession('room-g1', [{ uid: '1001', userType: 1 }])
    const session = useAiclawSession()
    expect(session.roomHasAiclaw.value).toBe(false)
  })

  it('roomHasAiclaw：群聊有 aiclaw 成员为 true', () => {
    mockFns.isAiclawByUserType.mockImplementation((userType) => userType === 4)
    setGroupSession('room-g1', [
      { uid: '1001', userType: 1 },
      { uid: '2001', userType: 4 }
    ])
    const session = useAiclawSession()
    expect(session.roomHasAiclaw.value).toBe(true)
    expect(session.showThinking.value).toBe(true)
  })

  it('showThinking：群聊无成员但有活跃思考时为 true', () => {
    setGroupSession('room-g1')
    mockIsCurrentRoomThinking.value = true
    const session = useAiclawSession()
    expect(session.showThinking.value).toBe(true)
  })

  it('showThinking：群聊无成员但有思考归档时为 true', () => {
    setGroupSession('room-g1')
    mockThinkingArchive.value.set('room-g1', [{} as any])
    const session = useAiclawSession()
    expect(session.showThinking.value).toBe(true)
  })
})
