import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useTrigger } from '@/hooks/useTrigger'

/**
 * #445 AI 退役：/ 保持纯文本（不触发任何弹层），@ / # 保持原有触发行为。
 * 直接调用真实 useTrigger（不 mock 被测 hook），用最小的 range/selection 替身满足签名；
 * happy-dom 下 querySelector('.ait-options'/'.topic-options') 为 null，弹层定位分支提前返回，
 * 断言只覆盖可见触发状态，不依赖定位细节。
 */

const fakeContext = () => ({
  range: { getBoundingClientRect: () => ({ x: 0, y: 0 }) } as unknown as Range,
  selection: {} as Selection,
  keyword: ''
})

const setup = () => {
  const personList = ref<unknown[]>([{ uid: 'u1', name: '张三' }])
  const topicList = ref<unknown[]>([{ uid: 't1', label: '话题1' }])
  const ait = ref(false)
  const aitKey = ref('')
  const topicDialogVisible = ref(false)
  const topicKeyword = ref('')
  const { handleTrigger } = useTrigger(personList, topicList, ait, aitKey, topicDialogVisible, topicKeyword)
  return { ait, aitKey, topicDialogVisible, topicKeyword, handleTrigger }
}

describe('#445 / 保持纯文本（不触发 AI 弹层）', () => {
  it('/ 输入不触发任何弹层且重置状态', async () => {
    const s = setup()
    const triggered = await s.handleTrigger('/deepseek', 9, fakeContext())
    expect(triggered).toBe(false)
    expect(s.ait.value).toBe(false)
    expect(s.topicDialogVisible.value).toBe(false)
  })
})

describe('#445 @ 保持提及触发', () => {
  it('@ 触发提及并记录关键词', async () => {
    const s = setup()
    const triggered = await s.handleTrigger('hello @张', 8, fakeContext())
    expect(triggered).toBe(true)
    expect(s.ait.value).toBe(true)
    expect(s.aitKey.value).toBe('张')
  })
})

describe('#445 # 保持话题触发', () => {
  it('# 触发话题弹层并记录关键词', async () => {
    const s = setup()
    const text = 'hi #话题'
    const triggered = await s.handleTrigger(text, text.length, fakeContext())
    expect(triggered).toBe(true)
    expect(s.topicDialogVisible.value).toBe(true)
    expect(s.topicKeyword.value).toBe('话题')
  })
})
