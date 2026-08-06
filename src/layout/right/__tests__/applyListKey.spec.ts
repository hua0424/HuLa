import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-017 #204 A2：layout/right 复用 ApplyList 时按 applyType 加 :key——
 * friend ↔ group 切换应销毁重建（onMounted 重触发拉取），不再复用旧面板数据。
 */

const mittHandlers = vi.hoisted(() => new Map<string, Function>())
const mittMock = vi.hoisted(() => ({
  emit: vi.fn(),
  on: (event: string, fn: Function) => mittHandlers.set(event, fn),
  off: vi.fn()
}))
vi.mock('@/hooks/useMitt.ts', () => ({ useMitt: mittMock }))

// ChatBox/Details 被 stub 但模块级 import 仍会拉起 chat store（顶层 new Worker）——打桩
vi.hoisted(() => {
  class WorkerStub {
    onerror: ((e: unknown) => void) | null = null
    postMessage() {}
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  }
  globalThis.Worker = WorkerStub as unknown as typeof Worker
})
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('@tauri-apps/plugin-notification', () => ({
  sendNotification: vi.fn(),
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue('granted')
}))
vi.mock('@/utils/UnreadCountManager', () => ({
  unreadCountManager: {
    refreshBadge: vi.fn(),
    calculateTotal: vi.fn(),
    setUpdateCallback: vi.fn(),
    requestUpdate: vi.fn()
  }
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getCurrent: () => ({ label: 'home' }) }
}))
vi.mock('@/router', () => ({
  default: { currentRoute: { value: { path: '/friendsList' } }, push: vi.fn() }
}))
// storeToRefs 只挑 ref/reactive：themes 必须给真 ref（ChatSetting.remarkClear.spec 同款坑）
vi.mock('@/stores/setting.ts', async () => {
  const { ref } = await import('vue')
  return {
    useSettingStore: () => ({ themes: ref({ content: 'LIGHT', pattern: 'LIGHT' }) })
  }
})
vi.mock('@/stores/global', async () => {
  const { ref } = await import('vue')
  return {
    useGlobalStore: () => ({ currentSessionRoomId: ref('') })
  }
})

const mountLog = vi.hoisted(() => [] as string[])
const ApplyListStub = {
  name: 'ApplyList',
  props: ['type'],
  template: '<div class="apply-list-stub">{{ type }}</div>',
  mounted() {
    mountLog.push(String((this as any).type))
  }
}

// ChatBox/Details 模块级 mock——stubs 不阻止 import，它们的真实模块会拉起 chat store
// （顶层 new Worker）/ Colorthief 等重量级副作用，直接整模块替换
vi.mock('@/components/rightBox/chatBox/index.vue', () => ({ default: { name: 'ChatBox', template: '<div />' } }))
vi.mock('@/components/rightBox/Details.vue', () => ({ default: { name: 'Details', template: '<div />' } }))

import RightLayout from '@/layout/right/index.vue'
import { MittEnum } from '@/enums'

const mountLayout = () =>
  mount(RightLayout, {
    global: {
      stubs: {
        ActionBar: true,
        ApplyList: ApplyListStub
      }
    }
  })

describe('layout/right ApplyList :key 切换重挂载（REQ-017 #204 A2）', () => {
  beforeEach(() => {
    mountLog.length = 0
    mittHandlers.clear()
    vi.clearAllMocks()
  })

  it('friend → group 切换：ApplyList 销毁重建（onMounted 重触发），渲染最新 type', async () => {
    const wrapper = mountLayout()
    await flushPromises()

    const applyShow = mittHandlers.get(MittEnum.APPLY_SHOW)
    expect(applyShow, 'APPLY_SHOW 监听应注册').toBeTruthy()

    applyShow!({ context: { type: 'apply', applyType: 'friend' } })
    await flushPromises()
    expect(wrapper.find('.apply-list-stub').text()).toBe('friend')

    applyShow!({ context: { type: 'apply', applyType: 'group' } })
    await flushPromises()
    expect(wrapper.find('.apply-list-stub').text()).toBe('group')

    // 两次切换各触发一次挂载（:key 销毁重建，非复用）
    expect(mountLog).toEqual(['friend', 'group'])
  })
})
