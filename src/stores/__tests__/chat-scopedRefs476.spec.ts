import { createPinia, disposePinia, setActivePinia, type PiniaPluginContext, type StoreGeneric } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { createApp, isRef, nextTick, toRaw } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageStatusEnum, MsgEnum, StoresEnum } from '@/enums'
import type { MessageType, SessionItem } from '@/services/types'
import type { SessionIdentity } from '@/services/sessionBinding'

const native = vi.hoisted(() => ({
  label: 'home',
  identity: { backendKey: 'http://a/api', uid: '4', sessionEpoch: 476 } as SessionIdentity,
  invoke: vi.fn(),
  listeners: new Set<() => void>()
}))
vi.hoisted(() => {
  class WorkerStub {
    postMessage() {}
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  }
  globalThis.Worker = WorkerStub as unknown as typeof Worker
})
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: any[]) => native.invoke(...args) }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => {
    const unsubscribe = () => native.listeners.delete(unsubscribe)
    native.listeners.add(unsubscribe)
    return unsubscribe
  })
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: native.label }) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getByLabel: vi.fn(async () => null), getCurrent: () => ({ label: native.label }) }
}))
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('@tauri-apps/plugin-notification', () => ({ sendNotification: vi.fn() }))
vi.mock('@/utils/PlatformConstants', () => ({
  isWeb: () => false,
  isMobile: () => native.label === 'mobile-home',
  isDesktop: () => native.label !== 'mobile-home',
  isWindows: () => true,
  isMac: () => false,
  isIOS: () => false
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/message' }), useRouter: () => ({ push: vi.fn() }) }))

// Only the external transports are controlled; each window has its own module scope and real Pinia/store/plugins.
class TestChannel {
  static instances: TestChannel[] = []
  onmessage?: (event: MessageEvent) => void
  closed = false
  postMessage = vi.fn((data: unknown) => {
    const snapshot = JSON.stringify(data)
    for (const peer of TestChannel.instances) {
      if (peer === this || peer.name !== this.name || peer.closed) continue
      queueMicrotask(() => {
        if (!peer.closed) peer.onmessage?.({ data: JSON.parse(snapshot) } as MessageEvent)
      })
    }
  })
  close = vi.fn(() => {
    this.closed = true
    this.onmessage = undefined
  })
  constructor(readonly name: string) {
    TestChannel.instances.push(this)
  }
}

const room = '3'
const message = (id = '10', content = 'initial'): MessageType =>
  ({
    fromUser: { uid: '2', username: 'fixture', avatar: '', locPlace: '' },
    message: {
      id,
      roomId: room,
      type: MsgEnum.TEXT,
      body: { content },
      sendTime: Number(id) || 1,
      messageMarks: {},
      status: MessageStatusEnum.SUCCESS
    },
    sendTime: Number(id) || 1
  }) as MessageType
const session = (): SessionItem =>
  ({ roomId: room, id: room, name: 'fixture', type: 1, unreadCount: 0, activeTime: 1 }) as SessionItem
const scopeKey = () => `${StoresEnum.CHAT}:${JSON.stringify([native.identity.backendKey, native.identity.uid])}`
const settle = async () => {
  await nextTick()
  await flushPromises()
}

type WindowStore = {
  chat: ReturnType<typeof import('@/stores/chat')['useChatStore']>
  global: ReturnType<typeof import('@/stores/global')['useGlobalStore']>
  binding: typeof import('@/services/sessionBinding')
  pinia: ReturnType<typeof createPinia>
  channel: TestChannel
  options: PiniaPluginContext['options']
  stores: StoreGeneric[]
  label: string
}
const windows: WindowStore[] = []
function close(item: WindowStore) {
  item.chat.clearAllExpirationTimers()
  item.chat.stopOnlineThinkingCalibration()
  for (const store of item.stores) store.$dispose()
  disposePinia(item.pinia)
  windows.splice(windows.indexOf(item), 1)
}
async function open(label: string, selectedRoom = room): Promise<WindowStore> {
  native.label = label
  // scopedChatStorage captures the window label when chat.ts is evaluated, as it does in a real WebView.
  vi.resetModules()
  const binding = await import('@/services/sessionBinding')
  await binding.initializeSessionBinding()
  const { scopedSharedState } = await import('@/stores/scopedSharedState')
  const { useChatStore } = await import('@/stores/chat')
  const { useGlobalStore } = await import('@/stores/global')
  const { useUserStore } = await import('@/stores/user')
  let options!: PiniaPluginContext['options']
  const stores: StoreGeneric[] = []
  const pinia = createPinia()
    .use((context) => {
      stores.push(context.store)
      if (context.store.$id === StoresEnum.CHAT) options = context.options
    })
    .use(scopedSharedState)
    .use(createPersistedState())
  createApp({ render: () => null }).use(pinia)
  setActivePinia(pinia)
  const global = useGlobalStore(pinia)
  global.currentSessionRoomId = selectedRoom
  useUserStore(pinia).userInfo = { uid: '4' } as never
  const chat = useChatStore(pinia)
  const channel = TestChannel.instances.filter((item) => item.name === `aichat-scoped:${StoresEnum.CHAT}`).at(-1)!
  const result = { chat, pinia, global, binding, channel, options, stores, label }
  windows.push(result)
  await settle()
  return result
}
let handle: (command: string, args: any) => unknown

beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', TestChannel)
  vi.stubGlobal('$message', { error: vi.fn() })
  Object.assign(window, { __TAURI_INTERNALS__: {} })
  TestChannel.instances = []
  localStorage.clear()
  native.identity = { backendKey: 'http://a/api', uid: '4', sessionEpoch: native.identity.sessionEpoch + 1 }
  handle = (command) => {
    if (command === 'page_msg') return { list: [], cursor: '', isLast: true, total: 0 }
    if (command === 'read_thinking_cache') return { items: [], loadedTriggerIds: [], visibleTriggerIds: [] }
    if (command === 'im_request_command') return []
  }
  native.invoke.mockReset().mockImplementation(async (command: string, args: any) => {
    if (command === 'get_session_binding')
      return { sessionEpoch: native.identity.sessionEpoch, binding: { ...native.identity } }
    if (args?.binding && JSON.stringify(args.binding) !== JSON.stringify(native.identity))
      throw new Error('native origin expired')
    return handle(command, args)
  })
})
afterEach(async () => {
  for (const item of [...windows]) close(item)
  for (const channel of TestChannel.instances) channel.close()
  for (const unsubscribe of native.listeners) unsubscribe()
  await settle()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const expectReadable = (chat: WindowStore['chat'], content: string, count: number) => {
  // $state alone is insufficient: reactive whole-key replacement can make it look correct while closures stay stale.
  expect(chat.$state.messageMap[room]['10'].message.body.content).toBe(content)
  expect(chat.messageMap[room]['10'].message.body.content).toBe(content)
  expect(chat.currentMessageMap['10'].message.body.content).toBe(content)
  expect(chat.getMessage('10')?.message.body.content).toBe(content)
  expect(chat.chatMessageList.map((item) => item.message.id)).toContain('10')
  expect(chat.getRecalledMessage('10')?.content).toBe(content)
  expect(chat.recalledMessages['10'].content).toBe(content)
  expect(chat.currentNewMsgCount).toEqual({ count, isStart: true })
  expect(chat.newMsgCount[room]).toEqual({ count, isStart: true })
}

function seed(chat: WindowStore['chat'], content = 'initial', count = 2) {
  chat.messageMap[room] = { '10': message('10', content) }
  chat.recordRecallMsg({ recallUid: '4', msg: message('10', content) })
  chat.currentNewMsgCount = { count, isStart: true }
}

describe('#476 real chat scoped receive/reset', () => {
  it('keeps three raw refs, two closure-only tables and the exact existing omit/pick contract', async () => {
    const { chat, options } = await open('home')
    for (const key of ['messageMap', 'recalledMessages', 'newMsgCount'])
      expect.soft(isRef(toRaw(chat.$state)[key as keyof typeof chat.$state]), `${key} raw binding`).toBe(true)
    for (const key of ['messageOptions', 'replyMapping']) expect(Object.hasOwn(chat.$state, key)).toBe(false)
    expect(options.share).toEqual({
      enable: true,
      initialize: true,
      omit: [
        'streamingMessages',
        'thinkingStreams',
        'thinkingByTrigger',
        'thinkingMetadataLoaded',
        'autoReplyMessages',
        'aiclawGroupConfigs'
      ]
    })
    expect((options.persist as { pick: string[] }).pick).toEqual([
      'sessionList',
      'sessionMap',
      'messageMap',
      'lastReadActiveTime'
    ])
  })

  it('initial and continuous main snapshots write through auxiliary getters and public read actions', async () => {
    const main = await open('home')
    seed(main.chat)
    // Cold auxiliary: messageMap must come from the channel, not persisted hydration hiding a stale closure.
    localStorage.removeItem(scopeKey())
    const aux = await open('modal-invite')
    expect(aux.chat).not.toBe(main.chat)
    expect(aux.pinia).not.toBe(main.pinia)
    expectReadable(aux.chat, 'initial', 2)
    main.chat.updateMsg({ msgId: '10', roomId: room, status: MessageStatusEnum.SUCCESS, body: { content: 'second' } })
    main.chat.recordRecallMsg({ recallUid: '4', msg: message('10', 'second') })
    main.chat.currentNewMsgCount.count++
    await settle()
    expectReadable(aux.chat, 'second', 3)
    aux.chat.updateMsg({
      msgId: '10',
      roomId: room,
      status: MessageStatusEnum.SUCCESS,
      body: { content: 'local-only' }
    })
    expect(aux.chat.getMessage('10')?.message.body.content).toBe('local-only')
    expect(main.chat.getMessage('10')?.message.body.content).toBe('second')

    const reply = message('11', 'reply')
    reply.message.body.reply = { id: '10', body: 'quoted' } as never
    main.chat.messageMap[room]['11'] = reply
    main.chat.messageMap[room]['12'] = message('12', 'target')
    await settle()
    expect(aux.chat.chatMessageList.find((item) => item.message.id === '11')?.message.body.reply).toMatchObject({
      id: '10',
      body: 'quoted'
    })
    main.chat.updateMsg({
      msgId: '11',
      roomId: room,
      status: MessageStatusEnum.SUCCESS,
      body: { content: 'reply', reply: { id: '12', body: 'changed quote' } }
    })
    await settle()
    const receivedReply = aux.chat.getMessage('11')!.message.body.reply
    expect(receivedReply.body).toBe('changed quote')
    expect(aux.chat.getMessage(receivedReply.id)?.message.body.content).toBe('target')
    expect(aux.channel.postMessage.mock.calls.every(([frame]) => !Reflect.has(Object(frame), 'state'))).toBe(true)
    const published = main.channel.postMessage.mock.calls.length
    await settle()
    expect(main.channel.postMessage.mock.calls).toHaveLength(published) // No snapshot echo loop.
    const payloads = main.channel.postMessage.mock.calls.map(
      ([frame]) => new TextEncoder().encode(JSON.stringify(frame)).length
    )
    console.info('[476 scoped observation]', {
      messages: main.chat.chatMessageList.length,
      publishes: published,
      totalBytes: payloads.reduce((sum, bytes) => sum + bytes, 0),
      lastBytes: payloads.at(-1)
    })

    main.chat.deleteMsg('10', room)
    main.chat.clearNewMsgCount()
    await settle()
    expect(aux.chat.getMessage('10')).toBeUndefined()
    expect(aux.chat.chatMessageList.map((item) => item.message.id)).not.toContain('10')
    expect(aux.chat.currentNewMsgCount).toEqual({ count: 0, isStart: true })
    main.chat.clearRoomMessages(room)
    await settle()
    expect(aux.chat.currentMessageMap).toEqual({})
    expect(aux.chat.currentNewMsgCount).toEqual({ count: 0, isStart: false })
    expect(aux.chat.getRecalledMessage('10')).toBeDefined()
    // Entering a room is the existing public expiry sweep; do not invent a reply-index or timer API.
    native.label = 'home'
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_001)
    await main.chat.changeRoom()
    await settle()
    expect(aux.chat.getRecalledMessage('10')).toBeUndefined()
    expect(aux.chat.recalledMessages).toEqual({})
    close(aux)
    const reopened = await open('modal-invite')
    expect(reopened.chat.currentMessageMap).toEqual({})
    expect(reopened.chat.getRecalledMessage('10')).toBeUndefined()
    expect(reopened.chat.currentNewMsgCount).toEqual({ count: 0, isStart: false })
  })

  it.each(['home', 'mobile-home'])('%s hydrates four picks and remains the only persistence writer', async (label) => {
    localStorage.setItem(
      scopeKey(),
      JSON.stringify({
        sessionList: [session()],
        sessionMap: { [room]: session() },
        messageMap: { [room]: { '10': message('10', 'disk') } },
        lastReadActiveTime: { [room]: 7 }
      })
    )
    const main = await open(label, '')
    expect(main.chat.chatMessageListByRoomId(room)[0].message.body.content).toBe('disk')
    // Existing pick names include this non-returned closure key; hydration can retain it in $state only.
    expect(Reflect.get(main.chat.$state, 'lastReadActiveTime')).toEqual({ [room]: 7 })
    main.global.currentSessionRoomId = room
    await settle()
    seed(main.chat, 'fresh')
    main.chat.sessionList = [session()]
    main.chat.sessionMap = { [room]: session() }
    await settle()
    const saved = JSON.parse(localStorage.getItem(scopeKey())!)
    expect(Object.keys(saved).sort()).toEqual(['sessionList', 'sessionMap', 'messageMap', 'lastReadActiveTime'].sort())
    expect(saved).toMatchObject({
      sessionList: [session()],
      sessionMap: { [room]: session() },
      messageMap: { [room]: { '10': message('10', 'fresh') } },
      lastReadActiveTime: { [room]: 7 }
    })
    // Simulate an older same-scope auxiliary disk snapshot. Main's live initial frame must replace it.
    localStorage.setItem(
      scopeKey(),
      JSON.stringify({ ...saved, messageMap: { [room]: { '10': message('10', 'stale disk') } } })
    )
    const writes = vi.spyOn(window.localStorage, 'setItem')
    const aux = await open('modal-invite')
    expect(aux.chat.getMessage('10')?.message.body.content).toBe('fresh')
    aux.chat.updateMsg({ msgId: '10', roomId: room, status: MessageStatusEnum.SUCCESS, body: { content: 'aux write' } })
    aux.chat.$persist()
    await settle()
    expect(writes.mock.calls.filter(([key]) => key.startsWith(`${StoresEnum.CHAT}:`))).toHaveLength(0)
    main.chat.updateMsg({ msgId: '10', roomId: room, status: MessageStatusEnum.SUCCESS, body: { content: 'next' } })
    await settle()
    expect(writes.mock.calls.some(([key]) => key === scopeKey())).toBe(true)
    expect(aux.chat.getMessage('10')?.message.body.content).toBe('next')
    expect(JSON.parse(localStorage.getItem(scopeKey())!).messageMap[room]['10'].message.body.content).toBe('next')
    close(aux)
    expect((await open('modal-invite')).chat.getMessage('10')?.message.body.content).toBe('next')
  })

  it('rejects auxiliary writes during main pagination and preserves existing WS seq/progress/failure-retry behavior', async () => {
    const main = await open('home')
    seed(main.chat)
    const aux = await open('modal-invite')
    const progress = main.chat.currentMessageOptions
    Object.assign(progress, { localExhausted: true, remoteStatus: 'more', remoteCursor: 'before', isLast: false })
    const pages: Array<{ resolve: (data: unknown) => void; reject: (error: Error) => void; cursor: string }> = []
    handle = (command, args) =>
      command === 'page_msg'
        ? new Promise((resolve, reject) => pages.push({ resolve, reject, cursor: args.param.cursor }))
        : undefined
    const pending = main.chat.loadMore()
    await settle()
    expect(pages).toHaveLength(1)
    expect(pages[0].cursor).toBe('before')
    for (let i = 0; i < 3; i++) {
      expect(main.chat.currentMessageOptions).toBe(progress)
      expect(main.chat.historyState.isLoading).toBe(true)
    }
    aux.chat.updateMsg({ msgId: '10', roomId: room, status: MessageStatusEnum.SUCCESS, body: { content: 'aux local' } })
    aux.channel.postMessage({ binding: { ...native.identity }, state: JSON.parse(JSON.stringify(aux.chat.$state)) })
    await settle()
    expect(main.chat.getMessage('10')?.message.body.content).toBe('initial')
    expect(main.chat.currentNewMsgCount).toEqual({ count: 2, isStart: true })
    // Existing ID before request: real pushMsg advances roomMsgSeq. New-during-request and stream/revoke conflicts remain non-goals.
    await main.chat.pushMsg(message('10', 'WS updated'))
    pages[0].resolve({
      list: [message('10', 'old page'), message('9', 'history')],
      cursor: 'after',
      isLast: false,
      total: 2
    })
    await pending
    await settle()
    expect(main.chat.getMessage('10')?.message.body.content).toBe('WS updated')
    expect(main.chat.getMessage('9')?.message.body.content).toBe('history')
    expect(aux.chat.getMessage('10')?.message.body.content).toBe('WS updated')
    expect(main.chat.currentMessageOptions).toBe(progress)
    expect(progress).toMatchObject({ remoteCursor: 'after', remoteStatus: 'more', isLoading: false, error: '' })
    expect(JSON.parse(localStorage.getItem(scopeKey())!).messageMap[room]['10'].message.body.content).toBe('WS updated')

    const failed = main.chat.loadMore()
    await settle()
    pages[1].reject(new Error('offline fixture'))
    await failed
    expect(progress).toMatchObject({ remoteCursor: 'after', isLoading: false })
    expect(progress.error).toContain('获取消息列表失败')
    expect(main.chat.getMessage('10')?.message.body.content).toBe('WS updated')
    const retry = main.chat.loadMore()
    await settle()
    expect(pages[2].cursor).toBe('after')
    pages[2].resolve({ list: [message('8', 'retry history')], cursor: 'retry', isLast: true, total: 1 })
    await retry
    expect(main.chat.currentMessageOptions).toBe(progress)
    expect(progress).toMatchObject({ remoteCursor: 'retry', remoteStatus: 'end', isLoading: false, error: '' })
    expect(main.chat.getMessage('8')?.message.body.content).toBe('retry history')
  })

  // Full cut-room + refresh de-duplication is already exercised by chat-historyProgressIdentity.spec.ts.
  const transitions = ['account', 'relogin', 'backend'] as const
  for (const label of ['home', 'mobile-home', 'modal-invite']) {
    it.each(transitions)(`${label} %s reset fences old hints, frames and pending IPC`, async (transition) => {
      const current = await open(label)
      seed(current.chat)
      const oldBinding = { ...native.identity }
      const oldState = JSON.parse(JSON.stringify(current.chat.$state))
      expect(current.chat.currentNewMsgCount).toEqual({ count: 2, isStart: true })
      let resolve!: (data: unknown) => void
      handle = (command) =>
        command === 'page_msg'
          ? new Promise((done) => {
              resolve = done
            })
          : undefined
      const pending = current.chat.fetchCurrentRoomRemoteOnce()
      await settle()
      expect(resolve).toBeTypeOf('function')
      native.identity = {
        ...native.identity,
        uid: transition === 'account' ? '5' : '4',
        backendKey: transition === 'backend' ? 'http://b/api' : 'http://a/api',
        sessionEpoch: native.identity.sessionEpoch + 1
      }
      await current.binding.initializeSessionBinding()
      handle = (command) => (command === 'page_msg' ? { list: [], cursor: '', isLast: true, total: 0 } : undefined)
      // scoped GLOBAL also resets the selected room. Reselect it before checking closures to avoid a false default.
      current.global.currentSessionRoomId = room
      expect(current.chat.currentNewMsgCount).toEqual({ count: 0, isStart: false })
      expect(current.chat.currentMessageMap).toEqual({})
      expect(current.chat.getRecalledMessage('10')).toBeUndefined()
      expect(current.chat.recalledMessages).toEqual({})
      expect(current.chat.newMsgCount[room]).toEqual({ count: 0, isStart: false })
      current.channel.onmessage?.({ data: { binding: oldBinding, state: oldState } } as MessageEvent)
      current.channel.onmessage?.({
        data: { binding: { ...native.identity, backendKey: 'http://stale/api' }, state: oldState }
      } as MessageEvent)
      resolve({ list: [message('10', 'stale IPC')], cursor: 'old', isLast: false, total: 1 })
      await pending
      expect(current.chat.currentMessageMap).toEqual({})
      expect(current.chat.getRecalledMessage('10')).toBeUndefined()
      expect(current.chat.currentNewMsgCount).toEqual({ count: 0, isStart: false })
      await settle()
    })
  }
})
