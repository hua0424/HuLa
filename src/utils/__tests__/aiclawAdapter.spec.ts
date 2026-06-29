import { describe, expect, it } from 'vitest'
import { isCcAdapter } from '@/utils/aiclawAdapter'

describe('aiclawAdapter', () => {
  it('claude-code 识别为 CC adapter', () => {
    expect(isCcAdapter('claude-code')).toBe(true)
    expect(isCcAdapter('Claude-Code')).toBe(true)
  })

  it('cc 也识别为 CC adapter（未来兼容）', () => {
    expect(isCcAdapter('cc')).toBe(true)
    expect(isCcAdapter('CC')).toBe(true)
  })

  it('openclaw / opencode / 空值 不是 CC adapter', () => {
    expect(isCcAdapter('openclaw')).toBe(false)
    expect(isCcAdapter('opencode')).toBe(false)
    expect(isCcAdapter('')).toBe(false)
    expect(isCcAdapter(undefined)).toBe(false)
    expect(isCcAdapter(null)).toBe(false)
  })
})
