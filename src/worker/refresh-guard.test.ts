import { describe, expect, it } from 'vitest'

import { createRefreshGuard } from './refresh-guard.ts'

describe('刷新退避闸门', () => {
  it('连续失败按指数拉长冷却，封顶后不再增长', () => {
    const guard = createRefreshGuard({ baseMs: 1_000, maxMs: 8_000 })

    expect(guard.noteFailure('repo', 0)).toBe(1_000)
    expect(guard.noteFailure('repo', 0)).toBe(2_000)
    expect(guard.noteFailure('repo', 0)).toBe(4_000)
    expect(guard.noteFailure('repo', 0)).toBe(8_000)
    expect(guard.noteFailure('repo', 0)).toBe(8_000)
  })

  it('冷却期内返回截止时刻，到期后放行试探', () => {
    const guard = createRefreshGuard({ baseMs: 1_000, maxMs: 8_000 })
    guard.noteFailure('repo', 5_000)

    expect(guard.blockedUntil('repo', 5_000)).toBe(6_000)
    expect(guard.blockedUntil('repo', 5_999)).toBe(6_000)
    expect(guard.blockedUntil('repo', 6_000)).toBeNull()
  })

  it('成功一次立刻归零：之后的失败重新从起步冷却算起', () => {
    const guard = createRefreshGuard({ baseMs: 1_000, maxMs: 8_000 })
    guard.noteFailure('repo', 0)
    guard.noteFailure('repo', 0)
    guard.noteSuccess('repo')

    expect(guard.view('repo')).toEqual({ failuresSinceSuccess: 0, coolingUntil: 0 })
    expect(guard.noteFailure('repo', 0)).toBe(1_000)
  })

  it('状态按缓存键隔离，不同仓库互不影响', () => {
    const guard = createRefreshGuard({ baseMs: 1_000, maxMs: 8_000 })
    guard.noteFailure('/repo-a', 0)

    expect(guard.blockedUntil('/repo-b', 0)).toBeNull()
    expect(guard.view('/repo-a').failuresSinceSuccess).toBe(1)
    expect(guard.view('/repo-b').failuresSinceSuccess).toBe(0)
  })
})
