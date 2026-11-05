import { shallowMount } from '@vue/test-utils'
import { ref } from 'vue'
import { NSplit } from 'naive-ui'
import { expect, it, vi } from 'vitest'

vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({ currentSession: ref({ account: 'human', detailId: 'agent' }) })
}))
vi.mock('pinia', () => ({ storeToRefs: (store: unknown) => store }))
vi.mock('../ChatHeader.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../ChatMain.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../ChatFooter.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../ChatSidebar.vue', () => ({ default: { template: '<div />' } }))
import ChatBox from '../index.vue'

it('allows only the footer split pane to display its command popup outside the pane', () => {
  const wrapper = shallowMount(ChatBox, { global: { stubs: { Bot: true } } })
  // Public Naive UI prop seam: Happy DOM cannot prove ancestor clipping or hit testing.
  expect(wrapper.getComponent(NSplit).props('pane2Style')).toEqual({ overflow: 'visible' })
  expect(wrapper.getComponent(NSplit).props('pane1Style')).toBeUndefined()
  wrapper.unmount()
})
