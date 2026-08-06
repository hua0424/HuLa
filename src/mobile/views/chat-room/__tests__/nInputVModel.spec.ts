import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, ref } from 'vue'
import { NInput } from 'naive-ui'

/**
 * REQ-017 #197 前置实证：naive-ui n-input 裸 v-model（modelValue 通道）不生效，
 * 必须用 v-model:value。此 spec 用真实 n-input 验证该行为假设，
 * 防「修复其实不需要」或「行为认知错误」。
 */

describe('naive-ui n-input v-model 通道实证', () => {
  it('裸 v-model（modelValue）不回写；v-model:value 回写', async () => {
    const Host = defineComponent({
      components: { NInput },
      setup() {
        const bare = ref('init')
        const valued = ref('init')
        return { bare, valued }
      },
      template: `
        <n-input data-testid="bare" v-model="bare" />
        <n-input data-testid="valued" v-model:value="valued" />
      `
    })
    const wrapper = mount(Host)

    const bareInput = wrapper.get('[data-testid="bare"] input')
    const valuedInput = wrapper.get('[data-testid="valued"] input')

    // 初始值：裸 v-model 不回显（modelValue 不映射 value），v-model:value 回显
    expect((valuedInput.element as HTMLInputElement).value).toBe('init')

    await bareInput.setValue('')
    await valuedInput.setValue('')

    const vm = wrapper.vm as unknown as { bare: string; valued: string }
    expect(vm.valued).toBe('')
    // 裸 v-model 不回写（这是 #197 备注清空在移动端失效的根因之一）
    expect(vm.bare).not.toBe('')
  })
})
