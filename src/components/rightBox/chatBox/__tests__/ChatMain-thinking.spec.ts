import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, reactive, defineComponent, unref } from 'vue'
import type { ThinkingState } from '@/types/thinking'

const chatMessageListRef = ref<any[]>([])
const currentSessionRoomIdRef = ref('room-1')
const thinkingByTriggerRef = reactive(new Map<string, Map<string, ThinkingState[]>>())
const getThinkingStatesByTriggerMsg = computed(() => (roomId: string, msgId: string) => {
  return thinkingByTriggerRef.get(roomId)?.get(msgId) ?? []
})

vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({
    currentSessionRoomId: currentSessionRoomIdRef
  })
}))
vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    get chatMessageList() {
      return chatMessageListRef.value
    },
    getThinkingStatesByTriggerMsg: (roomId: string | { value: string }, msgId: string) => {
      const resolvedRoomId = unref(roomId)
      return getThinkingStatesByTriggerMsg.value(resolvedRoomId, msgId)
    }
  })
}))

import { useChatStore } from '@/stores/chat'
import { useGlobalStore } from '@/stores/global'

const InlineThinkingCardStub = {
  props: ['thinking'],
  template: '<div data-testid="inline-thinking-card" :data-thinking-id="thinking.thinkingId" />'
}

const ChatMainThinkingStub = defineComponent({
  components: { InlineThinkingCard: InlineThinkingCardStub },
  template: `
    <div>
      <div
        v-for="item in chatStore.chatMessageList"
        :key="item.message.id"
        :data-message-id="item.message.id"
        class="message-wrapper"
      >
        <InlineThinkingCard
          v-for="thinking in chatStore.getThinkingStatesByTriggerMsg(globalStore.currentSessionRoomId, item.message.id)"
          :key="thinking.thinkingId"
          :thinking="thinking"
          data-testid="inline-thinking-card"
        />
      </div>
    </div>
  `,
  setup() {
    const chatStore = useChatStore()
    const globalStore = useGlobalStore()
    return { chatStore, globalStore }
  }
})

const mountStub = () => mount(ChatMainThinkingStub)

describe('ChatMain 内联思考卡渲染（REQ-014）', () => {
  beforeEach(() => {
    chatMessageListRef.value = []
    currentSessionRoomIdRef.value = 'room-1'
    thinkingByTriggerRef.clear()
  })

  it('消息列表为空时不渲染思考卡', () => {
    chatMessageListRef.value = []
    const wrapper = mountStub()
    expect(wrapper.findAll('[data-testid="inline-thinking-card"]')).toHaveLength(0)
  })

  it('thinkingByTrigger 中某 triggerMsgId 有状态时，卡片渲染在该消息下方', () => {
    chatMessageListRef.value = [
      {
        message: { id: 'msg-1', type: 1, sendTime: 1000 },
        fromUser: { uid: 'u1' },
        isCheck: false
      },
      {
        message: { id: 'msg-2', type: 1, sendTime: 2000 },
        fromUser: { uid: 'u1' },
        isCheck: false
      }
    ]

    thinkingByTriggerRef.set('room-1', new Map())
    thinkingByTriggerRef.get('room-1')!.set('msg-2', [
      {
        thinkingId: 'tk-001',
        aiclawId: 2001,
        aiclawName: 'Bot',
        aiclawAvatar: '',
        roomId: 'room-1',
        status: 'thinking',
        startTime: Date.now(),
        collapsed: false
      }
    ])

    const wrapper = mountStub()
    const cards = wrapper.findAll('[data-testid="inline-thinking-card"]')
    expect(cards).toHaveLength(1)
    expect(cards[0].attributes('data-thinking-id')).toBe('tk-001')

    const host = cards[0].element.closest('[data-message-id]')
    expect(host?.getAttribute('data-message-id')).toBe('msg-2')
  })

  it('同一触发消息下多张卡片按桶内顺序渲染', () => {
    chatMessageListRef.value = [
      {
        message: { id: 'msg-1', type: 1, sendTime: 1000 },
        fromUser: { uid: 'u1' },
        isCheck: false
      }
    ]

    thinkingByTriggerRef.set('room-1', new Map())
    thinkingByTriggerRef.get('room-1')!.set('msg-1', [
      {
        thinkingId: 'tk-a',
        aiclawId: 2001,
        aiclawName: 'A',
        aiclawAvatar: '',
        roomId: 'room-1',
        status: 'thinking',
        startTime: 1,
        collapsed: false
      },
      {
        thinkingId: 'tk-b',
        aiclawId: 2002,
        aiclawName: 'B',
        aiclawAvatar: '',
        roomId: 'room-1',
        status: 'thinking',
        startTime: 2,
        collapsed: false
      }
    ])

    const wrapper = mountStub()
    const ids = wrapper.findAll('[data-testid="inline-thinking-card"]').map((el) => el.attributes('data-thinking-id'))
    expect(ids).toEqual(['tk-a', 'tk-b'])
  })
})
