import { readFileSync } from 'node:fs'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

const api = vi.hoisted(() => ({
  getAgentCommandApprovals: vi.fn(),
  approveAgentCommand: vi.fn(),
  rejectAgentCommand: vi.fn()
}))
vi.mock('@/services/agentCommands', () => api)
const native = vi.hoisted(() => ({
  desktop: false,
  callback: undefined as ((event: { payload: { aiclawUid: string } }) => void) | undefined,
  unlisten: vi.fn(),
  listenBound: vi.fn()
}))
vi.mock('@/utils/PlatformConstants', () => ({ isDesktop: () => native.desktop }))
vi.mock('@/services/sessionBinding', () => ({ listenBound: native.listenBound }))
import AiclawCommandApprovalList from '@/components/aiclaw/AiclawCommandApprovalList.vue'
import { useMitt } from '@/hooks/useMitt'
import { WsResponseMessageType } from '@/services/wsType'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': { aiclaw: aiclawZh } }
})

const item = {
  requestId: 'r1',
  roomId: 'g1',
  aiclawUid: 'agent',
  capabilityId: 'skill:x',
  parameters: { arguments: 'native' },
  callerUid: 11,
  expiresAt: Date.now() + 60_000
}

beforeEach(() => {
  native.desktop = false
  native.callback = undefined
  native.unlisten.mockReset()
  native.listenBound.mockReset().mockImplementation(async (event, callback) => {
    expect(event).toBe('ws-command-approval-request')
    native.callback = callback
    return native.unlisten
  })
  api.getAgentCommandApprovals.mockReset().mockResolvedValue([item])
  api.approveAgentCommand.mockReset().mockResolvedValue({})
  api.rejectAgentCommand.mockReset().mockResolvedValue({})
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('stays scoped to the owner aiclaw/room and approves the frozen request', async () => {
  const wrapper = mount(AiclawCommandApprovalList, {
    props: { aiclawUid: 'agent', roomId: 'g1' },
    global: { plugins: [i18n] }
  })
  await flushPromises()
  expect(wrapper.find('[data-testid="aiclaw-command-approval-row-r1"]').exists()).toBe(true)
  expect(wrapper.text()).toContain('11')
  expect(wrapper.text()).toContain('native')
  await wrapper.find('[data-testid="aiclaw-command-approval-approve-r1"]').trigger('click')
  await flushPromises()
  expect(api.approveAgentCommand).toHaveBeenCalledExactlyOnceWith('r1')
  wrapper.unmount()
})

it('hides approvals from another room and rejects only the chosen request', async () => {
  const wrapper = mount(AiclawCommandApprovalList, {
    props: { aiclawUid: 'agent', roomId: 'g2' },
    global: { plugins: [i18n] }
  })
  await flushPromises()
  expect(wrapper.find('[data-testid="aiclaw-command-approval-row-r1"]').exists()).toBe(false)
  wrapper.unmount()

  const matching = mount(AiclawCommandApprovalList, {
    props: { aiclawUid: 'agent', roomId: 'g1' },
    global: { plugins: [i18n] }
  })
  await flushPromises()
  await matching.find('[data-testid="aiclaw-command-approval-reject-r1"]').trigger('click')
  await flushPromises()
  expect(api.rejectAgentCommand).toHaveBeenCalledExactlyOnceWith('r1')
  matching.unmount()
})

it('refreshes the already-open desktop owner view on a bound native request without local mitt', async () => {
  native.desktop = true
  api.getAgentCommandApprovals.mockResolvedValue([])
  const wrapper = mount(AiclawCommandApprovalList, {
    props: { aiclawUid: 'agent' },
    global: { plugins: [i18n] }
  })
  try {
    await flushPromises()
    expect(native.listenBound).toHaveBeenCalledOnce()
    expect(wrapper.find('[data-testid="aiclaw-command-approval-row-r1"]').exists()).toBe(false)
    api.getAgentCommandApprovals.mockResolvedValue([item])
    native.callback?.({ payload: { aiclawUid: 'other-agent' } })
    await flushPromises()
    expect(api.getAgentCommandApprovals).toHaveBeenCalledTimes(1)
    native.callback?.({ payload: { aiclawUid: 'agent' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="aiclaw-command-approval-row-r1"]').exists()).toBe(true)
  } finally {
    wrapper.unmount()
  }
  expect(native.unlisten).toHaveBeenCalledOnce()
})

it('retains same-window mitt refresh on Web and mobile', async () => {
  api.getAgentCommandApprovals.mockResolvedValue([])
  const wrapper = mount(AiclawCommandApprovalList, {
    props: { aiclawUid: 'agent' },
    global: { plugins: [i18n] }
  })
  try {
    await flushPromises()
    api.getAgentCommandApprovals.mockResolvedValue([item])
    useMitt.emit(WsResponseMessageType.COMMAND_APPROVAL_REQUEST, { aiclawUid: 'agent' })
    await flushPromises()
    expect(wrapper.find('[data-testid="aiclaw-command-approval-row-r1"]').exists()).toBe(true)
    expect(native.listenBound).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
  }
})

it('releases a native subscription that finishes registering after unmount', async () => {
  native.desktop = true
  let registered!: (unlisten: () => void) => void
  native.listenBound.mockImplementation(
    () =>
      new Promise<() => void>((resolve) => {
        registered = resolve
      })
  )
  const wrapper = mount(AiclawCommandApprovalList, {
    props: { aiclawUid: 'agent' },
    global: { plugins: [i18n] }
  })
  wrapper.unmount()
  registered(native.unlisten)
  await flushPromises()
  expect(native.unlisten).toHaveBeenCalledOnce()
  expect(api.getAgentCommandApprovals).not.toHaveBeenCalled()
})

it('keeps the native request route to the separate desktop management window', () => {
  const rust = readFileSync('src-tauri/src/websocket/client.rs', 'utf8')
  const requestArm = rust.split('"commandApprovalRequest" => {')[1]?.split('"commandApprovalResult"')[0]
  expect(requestArm).toMatch(/events\.emit_to\(\s*"aiAssistant",\s*"ws-command-approval-request"/)
  expect(requestArm).toContain('events.emit_to_owner("ws-command-approval-request"')
})
