/**
 * 判断 aiclaw 是否配置为 Claude Code（CC）adapter。
 *
 * 当前后端 adapter_type 为 'claude-code'；若未来简化为 'cc'，可在此兜底，
 * 避免调用方散落判断。
 */
export const isCcAdapter = (adapterType?: string | null): boolean => {
  if (!adapterType) return false
  const lower = adapterType.toLowerCase()
  return lower === 'claude-code' || lower === 'cc'
}
