/**
 * aichatoverview#285 回归：历史回填纯策略（先加测试再实现）。
 *
 * 覆盖：首屏决策（本地非空不请求远端 / 本地空自动回填）、loadMore 决策、
 * 远端游标协议校验、预热统计口径（空结果不冒充成功）、远端 ID 去重。
 */
import { describe, expect, it } from 'vitest'
import {
  decideFirstScreen,
  decideLoadMore,
  deriveIsLast,
  formatPreheatLog,
  shouldAdvanceRemote,
  splitFreshRemoteIds
} from '@/utils/historyBackfill'

describe('history backfill strategy (#285)', () => {
  it('首屏本地非空直接渲染，不请求远端', () => {
    expect(decideFirstScreen(20, 'unknown')).toBe('render-local')
    expect(decideFirstScreen(1, 'more')).toBe('render-local')
  })

  it('首屏本地为空且远端未知时自动回填一页', () => {
    expect(decideFirstScreen(0, 'unknown')).toBe('backfill-remote')
  })

  it('首屏本地为空但远端已确认结束时不再请求', () => {
    expect(decideFirstScreen(0, 'end')).toBe('render-local')
    expect(decideFirstScreen(0, 'more')).toBe('render-local')
  })

  it('结束仅当本地耗尽且远端确认结束', () => {
    expect(deriveIsLast({ localExhausted: true, remoteStatus: 'end' })).toBe(true)
    // 本地末页不能当成服务端结束
    expect(deriveIsLast({ localExhausted: true, remoteStatus: 'unknown' })).toBe(false)
    expect(deriveIsLast({ localExhausted: true, remoteStatus: 'more' })).toBe(false)
    expect(deriveIsLast({ localExhausted: false, remoteStatus: 'end' })).toBe(false)
  })

  it('loadMore：本地未耗尽走本地，耗尽后走远端，结束后停止', () => {
    expect(decideLoadMore({ localExhausted: false, remoteStatus: 'unknown' })).toBe('local')
    expect(decideLoadMore({ localExhausted: false, remoteStatus: 'more' })).toBe('local')
    expect(decideLoadMore({ localExhausted: true, remoteStatus: 'unknown' })).toBe('remote')
    expect(decideLoadMore({ localExhausted: true, remoteStatus: 'more' })).toBe('remote')
    expect(decideLoadMore({ localExhausted: true, remoteStatus: 'end' })).toBe('stop')
    expect(decideLoadMore({ localExhausted: false, remoteStatus: 'end' })).toBe('local')
  })

  it('远端空页但 isLast=false 时保留继续入口（黑名单/墓碑/整页重复过滤）', () => {
    // 决策层不结束：local 耗尽 + remote more => remote
    expect(decideLoadMore({ localExhausted: true, remoteStatus: 'more' })).toBe('remote')
  })

  it('isLast=false 却 cursor 缺失或不前进视为协议异常', () => {
    expect(shouldAdvanceRemote(false, '', null)).toBe(false)
    expect(shouldAdvanceRemote(false, '', '')).toBe(false)
    expect(shouldAdvanceRemote(false, '42', '42')).toBe(false)
    expect(shouldAdvanceRemote(false, '', '43')).toBe(true)
    expect(shouldAdvanceRemote(true, '', null)).toBe(true)
    expect(shouldAdvanceRemote(true, '42', undefined)).toBe(true)
  })

  it('预热统计区分有消息、空结果与失败', () => {
    const line = formatPreheatLog({ withMessages: 7, empty: 2, failed: 0, total: 9 })
    expect(line).toBe('本地预加载：有消息 7，空结果 2（远端未验证），失败 0，总计 9')
  })

  it('远端重复页按 ID 去重，不跳过缺口', () => {
    const { fresh, duplicate } = splitFreshRemoteIds(new Set(['1', '2']), ['2', '3', '3', '4'])
    expect(fresh).toEqual(['3', '4'])
    expect(duplicate).toBe(2)
  })
})
