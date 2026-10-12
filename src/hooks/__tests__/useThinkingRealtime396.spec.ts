import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick } from 'vue'

/**
 * aichatoverview#396：移动端实时思考链贯通。
 *
 * 真实链路接缝：真实 MobileLayout（移动入口）+ 真实 mitt + 真实 chat store，
 * 仅 Tauri/HTTP 传输层受控。验证原生投递修复后，START/END 经账号级单实例消费者
 * 进入真实 store，并按 exact trigger 锚定成卡。
 */

const native = vi.hoisted(() => ({ invoke: vi.fn(), listeners: new Map<string, (event: any) => void>() }))
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
vi.mock('@/services/thinkingService', () => ({
  loadThinkingByTrigger: vi.fn(async () => []),
  loadThinkingDetail: vi.fn(async () => null)
}))
vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(),
  listen: vi.fn(async (name: string, callback: (event: any) => void) => {
    native.listeners.set(name, callback)
    return () => native.listeners.delete(name)
  })
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'mobile-home' }) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getByLabel: vi.fn(async () => null), getCurrent: () => ({ label: 'mobile-home' }) }
}))
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ label: 'mobile-home' }) }))
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('@tauri-apps/plugin-notification', () => ({ sendNotification: vi.fn() }))
vi.mock('@/utils/PlatformConstants', () => ({
  isWeb: () => false,
  isDesktop: () => false,
  isMobile: () => true,
  isWindows: () => false,
  isMac: () => false,
  isLinux: () => false,
  isAndroid: () => true,
  isIOS: () => false
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/mobile/message' }), useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/utils/UnreadCountManager', () => ({
  unreadCountManager: {
    refreshBadge: vi.fn(),
    calculateTotal: vi.fn(),
    setUpdateCallback: vi.fn(),
    requestUpdate: vi.fn()
  }
}))

// Only native transport is controlled. Layout, mitt, chat store and session guard are real.
import MobileLayout from '@/mobile/components/MobileLayout.vue'
import { useThinkingRealtime } from '@/hooks/useThinkingRealtime'
import { useMitt } from '@/hooks/useMitt'
import { WsResponseMessageType } from '@/services/wsType'
import { initializeSessionBinding, type SessionIdentity } from '@/services/sessionBinding'
import { useChatStore } from '@/stores/chat'

const ROOM = '175988626166790'
const AICLAW_A = '140789091499530'
const AICLAW_B = '140789091499531'
const TRIGGER = '211143248201230'
const think = (suffix: string) => `2108938288996745${suffix}`
const run = (suffix: string) => `run-396-${suffix}`
const startOf = (thinkingId: string, fromUid: string, extra: Record<string, unknown> = {}) => ({
  thinkingId,
  fromUid,
  roomId: ROOM,
  triggerMsgId: TRIGGER,
  aiclawName: 'verify396',
  clientRunId: run(thinkingId.slice(-3)),
  ...extra
})
const endOf = (thinkingId: string, fromUid: string) => ({
  thinkingId,
  roomId: ROOM,
  fromUid,
  clientRunId: run(thinkingId.slice(-3)),
  status: 'complete' as const,
  durationMs: 1200
})

// 与 ChatMain 相同的锚定查询：按 exact trigger 取卡并渲染在其消息宿主下。
const Probe = defineComponent({
  props: { roomId: { type: String, required: true }, triggerId: { type: String, required: true } },
  setup(props) {
    const chatStore = useChatStore()
    const cards = computed(() => chatStore.getThinkingStatesByTriggerMsg(props.roomId, props.triggerId))
    return { cards }
  },
  template: `
    <div :data-message-id="triggerId" class="message-wrapper">
      <div
        v-for="t in cards"
        :key="t.thinkingId"
        data-testid="inline-thinking-card"
        :data-thinking-id="t.thinkingId"
        :data-status="t.status"
      />
    </div>`
})
// 桌面入口等价宿主：只订阅共享消费者，不挂载重型桌面布局。
const DesktopHost = defineComponent({
  setup() {
    useThinkingRealtime()
    return () => null
  }
})

let identity: SessionIdentity
let epoch = 700
let hosts: VueWrapper<any>[] = []

const mountMobile = () =>
  mount(MobileLayout, {
    slots: { default: () => h(Probe, { roomId: ROOM, triggerId: TRIGGER }) }
  })

beforeEach(async () => {
  setActivePinia(createPinia())
  Object.assign(window, { __TAURI_INTERNALS__: {} })
  identity = { backendKey: 'http://a/api', uid: '4', sessionEpoch: ++epoch }
  native.invoke.mockReset().mockImplementation(async (command: string, args: any) => {
    if (command === 'get_session_binding') return { sessionEpoch: identity.sessionEpoch, binding: { ...identity } }
    if (args?.binding && JSON.stringify(args.binding) !== JSON.stringify(identity))
      throw new Error('native origin expired')
    if (command === 'read_thinking_cache') return { items: [], loadedTriggerIds: [], visibleTriggerIds: [] }
    return undefined
  })
  await initializeSessionBinding()
})

afterEach(() => {
  for (const host of hosts) host.unmount()
  hosts = []
})

const cards = (wrapper: VueWrapper<any>) => wrapper.findAll('[data-testid="inline-thinking-card"]')

describe('#396 移动端实时思考链', () => {
  it('移动入口 START 建卡并锚定 exact trigger，END 终态正确且重复 END 幂等', async () => {
    hosts.push(mountMobile())
    const store = useChatStore()
    const id = think('101')

    useMitt.emit(WsResponseMessageType.THINKING_START, startOf(id, AICLAW_A))
    await nextTick()
    expect(store.getThinkingStatesByTriggerMsg(ROOM, TRIGGER).map((t) => t.thinkingId)).toContain(id)
    let rendered = cards(hosts[0])
    expect(rendered).toHaveLength(1)
    expect(rendered[0].attributes('data-thinking-id')).toBe(id)
    expect(rendered[0].attributes('data-status')).toBe('thinking')
    expect(rendered[0].element.closest('[data-message-id]')?.getAttribute('data-message-id')).toBe(TRIGGER)

    useMitt.emit(WsResponseMessageType.THINKING_END, endOf(id, AICLAW_A))
    await nextTick()
    rendered = cards(hosts[0])
    expect(rendered).toHaveLength(1)
    expect(rendered[0].attributes('data-status')).toBe('complete')

    useMitt.emit(WsResponseMessageType.THINKING_END, endOf(id, AICLAW_A))
    await nextTick()
    expect(cards(hosts[0])).toHaveLength(1)
  })

  it('同一 trigger 多助理各建一卡', async () => {
    hosts.push(mountMobile())
    const idA = think('102')
    const idB = think('103')
    useMitt.emit(WsResponseMessageType.THINKING_START, startOf(idA, AICLAW_A))
    useMitt.emit(WsResponseMessageType.THINKING_START, startOf(idB, AICLAW_B))
    await nextTick()
    const rendered = cards(hosts[0])
    expect(rendered.map((el) => el.attributes('data-thinking-id')).sort()).toEqual([idA, idB].sort())
  })

  it('桌面与移动入口共存时只消费一次，不双写', async () => {
    hosts.push(mount(DesktopHost))
    hosts.push(mountMobile())
    const store = useChatStore()
    const spy = vi.spyOn(store, 'startThinking')
    useMitt.emit(WsResponseMessageType.THINKING_START, startOf(think('104'), AICLAW_A))
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(cards(hosts[1])).toHaveLength(1)
  })

  it('宿主卸载不丢订阅：剩单宿主仍消费，全卸载后停消费，重挂恢复', async () => {
    const desktop = mount(DesktopHost)
    hosts.push(desktop)
    hosts.push(mountMobile())
    const store = useChatStore()
    const spy = vi.spyOn(store, 'startThinking')

    desktop.unmount()
    hosts.splice(hosts.indexOf(desktop), 1)
    useMitt.emit(WsResponseMessageType.THINKING_START, startOf(think('105'), AICLAW_A))
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)

    for (const host of hosts) host.unmount()
    hosts = []
    useMitt.emit(WsResponseMessageType.THINKING_START, startOf(think('106'), AICLAW_A))
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)

    hosts.push(mountMobile())
    useMitt.emit(WsResponseMessageType.THINKING_START, startOf(think('107'), AICLAW_A))
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(cards(hosts[0])).toHaveLength(1)
  })

  it('旧 epoch 帧被拒绝，不建卡', async () => {
    hosts.push(mountMobile())
    const stale = { ...identity, sessionEpoch: identity.sessionEpoch - 1 }
    useMitt.emit(WsResponseMessageType.THINKING_START, startOf(think('108'), AICLAW_A, { _sessionBinding: stale }))
    await nextTick()
    expect(cards(hosts[0])).toHaveLength(0)
  })
})
