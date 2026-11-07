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
import AiclawCommandApprovalList from '@/components/aiclaw/AiclawCommandApprovalList.vue'

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
