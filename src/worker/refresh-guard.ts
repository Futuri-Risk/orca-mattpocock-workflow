/**
 * 刷新退避闸门：连续失败后的冷却与半开试探。
 *
 * 每次失败把冷却按指数拉长；冷却期内刷新不发后端、直接回本地缓存。
 * 冷却到期自然放行一次试探，成功一次立刻归零。
 * 刷新失败时保留旧数据，退避只是让后端别被反复打；它是「稍等」，不是拒绝。
 */

/** 闸门参数；缺省 5 秒起步、5 分钟封顶。 */
export interface RefreshGuardOptions {
  /** 第一次失败的冷却时长。 */
  readonly baseMs?: number
  /** 冷却时长上限。 */
  readonly maxMs?: number
}

/** 退避闸门口：状态按缓存键隔离，时钟由调用方传入，闸门自己不碰时间。 */
export interface RefreshGuard {
  /**
   * 冷却截止时刻；不在冷却中（或已到期）返回 null。到期即放行一次试探。
   * @param key - 缓存键（与本地快照库同一套规则）。
   * @param at - 当前时刻。
   */
  blockedUntil(key: string, at: number): number | null
  /**
   * 成功一次：失败计数立刻归零，冷却取消。
   * @param key - 缓存键。
   */
  noteSuccess(key: string): void
  /**
   * 记录一次失败，返回新的冷却截止时刻。
   * @param key - 缓存键。
   * @param at - 当前时刻。
   */
  noteFailure(key: string, at: number): number
  /** 诊断读数：当前失败计数与冷却截止。 */
  view(key: string): { readonly failuresSinceSuccess: number; readonly coolingUntil: number }
}

/**
 * 创建退避闸门。
 * @param options - 冷却步长与上限。
 * @returns 退避闸门。
 */
export function createRefreshGuard(options: RefreshGuardOptions = {}): RefreshGuard {
  const baseMs = options.baseMs ?? 5_000
  const maxMs = options.maxMs ?? 300_000
  const states = new Map<string, { failuresSinceSuccess: number; coolingUntil: number }>()

  function stateOf(key: string) {
    let state = states.get(key)
    if (state === undefined) {
      state = { failuresSinceSuccess: 0, coolingUntil: 0 }
      states.set(key, state)
    }
    return state
  }

  return {
    blockedUntil(key, at) {
      const state = states.get(key)
      if (state === undefined || state.coolingUntil <= at) return null
      return state.coolingUntil
    },
    noteSuccess(key) {
      const state = stateOf(key)
      state.failuresSinceSuccess = 0
      state.coolingUntil = 0
    },
    noteFailure(key, at) {
      const state = stateOf(key)
      state.failuresSinceSuccess += 1
      const backoffMs = Math.min(
        baseMs * 2 ** Math.min(state.failuresSinceSuccess - 1, 16),
        maxMs,
      )
      state.coolingUntil = at + backoffMs
      return state.coolingUntil
    },
    view(key) {
      const state = states.get(key)
      return state === undefined
        ? { failuresSinceSuccess: 0, coolingUntil: 0 }
        : { ...state }
    },
  }
}
