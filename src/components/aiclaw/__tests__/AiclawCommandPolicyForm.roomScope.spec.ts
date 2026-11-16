import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

const api = vi.hoisted(() => ({
  getCommandPolicy: vi.fn(),
  putCommandPolicy: vi.fn(),
  getAgentCommandApprovals: vi.fn(),
  approveAgentCommand: vi.fn(),
  rejectAgentCommand: vi.fn()
}))
vi.mock('@/services/agentCommands', () => api)
import AiclawCommandPolicyForm from '@/components/aiclaw/AiclawCommandPolicyForm.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': { aiclaw: aiclawZh } }
})
const mixedPolicy = {
  defaults: [{ roomId: 0, capabilityId: 'skill:*', state: 'open' }],
  rows: [
    { roomId: 0, capabilityId: 'skill:default', state: 'closed', version: 2 },
    { roomId: 202, capabilityId: 'skill:shared', state: 'closed', mode: 'all', version: 19 },
    { roomId: 202, capabilityId: 'skill:other-room', state: 'closed', version: 20 },
    {
      roomId: 101,
      capabilityId: 'skill:shared',
      state: 'approval_required',
      mode: 'list',
      allowedUids: [11],
      version: 7
    }
  ],
  effective: { 'skill:shared': 'approval_required' }
}
const mountForm = (roomId?: string) =>
  mount(AiclawCommandPolicyForm, {
    props: { aiclawUid: 'agent', roomId },
    global: { plugins: [i18n] }
  })

enableAutoUnmount(afterEach)
beforeEach(() => {
  vi.clearAllMocks()
  api.getCommandPolicy.mockResolvedValue(mixedPolicy)
  api.putCommandPolicy.mockResolvedValue({})
  api.getAgentCommandApprovals.mockResolvedValue([])
})

it('shows only default overrides on the default page when the response includes multiple rooms', async () => {
  const wrapper = mountForm()
  await flushPromises()
  expect(api.getCommandPolicy).toHaveBeenCalledExactlyOnceWith({ aiclawUid: 'agent' })
  expect(
    wrapper.findAll('[data-testid^="aiclaw-command-policy-row-"]').map((row) => row.attributes('data-testid'))
  ).toEqual(['aiclaw-command-policy-row-skill:default'])
  await wrapper.get('[data-testid="aiclaw-command-policy-save-skill:default"]').trigger('click')
  await flushPromises()
  expect(api.putCommandPolicy).toHaveBeenCalledExactlyOnceWith({
    aiclawUid: 'agent',
    items: [{ capabilityId: 'skill:default', state: 'closed', version: 2 }]
  })
})

it('shows and saves only the selected room override and its version', async () => {
  const wrapper = mountForm('101')
  await flushPromises()
  expect(api.getCommandPolicy).toHaveBeenCalledExactlyOnceWith({ aiclawUid: 'agent', roomId: '101' })
  expect
    .soft(wrapper.findAll('[data-testid^="aiclaw-command-policy-row-"]').map((row) => row.attributes('data-testid')))
    .toEqual(['aiclaw-command-policy-row-skill:shared'])
  await wrapper.get('[data-testid="aiclaw-command-policy-save-skill:shared"]').trigger('click')
  await flushPromises()
  expect(api.putCommandPolicy).toHaveBeenCalledExactlyOnceWith({
    aiclawUid: 'agent',
    roomId: '101',
    items: [{ capabilityId: 'skill:shared', state: 'approval_required', mode: 'list', allowedUids: [11], version: 7 }]
  })
})

it('does not present another room override as editable when the selected room has none', async () => {
  const wrapper = mountForm('303')
  await flushPromises()
  expect(api.getCommandPolicy).toHaveBeenCalledExactlyOnceWith({ aiclawUid: 'agent', roomId: '303' })
  expect(wrapper.findAll('[data-testid^="aiclaw-command-policy-row-"]')).toHaveLength(0)
  expect(api.putCommandPolicy).not.toHaveBeenCalled()
})

it('keeps distinct string room IDs beyond the safe integer range separate', async () => {
  api.getCommandPolicy.mockResolvedValue({
    defaults: [],
    rows: [
      { roomId: '9007199254740992', capabilityId: 'skill:large-room', state: 'closed', version: 31 },
      { roomId: '9007199254740993', capabilityId: 'skill:large-room', state: 'open', version: 32 }
    ],
    effective: { 'skill:large-room': 'open' }
  })
  const wrapper = mountForm('9007199254740993')
  await flushPromises()
  expect.soft(wrapper.findAll('[data-testid="aiclaw-command-policy-row-skill:large-room"]')).toHaveLength(1)
  await wrapper.get('[data-testid="aiclaw-command-policy-save-skill:large-room"]').trigger('click')
  await flushPromises()
  expect(api.putCommandPolicy).toHaveBeenCalledExactlyOnceWith({
    aiclawUid: 'agent',
    roomId: '9007199254740993',
    items: [{ capabilityId: 'skill:large-room', state: 'open', mode: 'all', allowedUids: undefined, version: 32 }]
  })
})
