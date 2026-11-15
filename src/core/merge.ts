/**
 * 增量合并：把「上次拉到的票」与「此后变更过的票」合成一份与全量重拉等价的结果。
 *
 * 纯函数：core 不做 IO，也不认识任何后端。合并口径只有一条——
 * 同一张工单取更新时间较新的一份，窗口没提到的票原样保留。
 *
 * 不做窗口裁剪：已经翻过的页不能因为一次增量刷新被裁掉，否则游标已经越过
 * 被裁掉的票，它们再也取不回来。窗口边界由 `nextCursor` 与已加载数表达。
 */
import type { Ticket } from './ticket.ts'

/**
 * 合并缓存里的票与增量返回的票。
 *
 * - 增量里没有的票原样保留：时间窗口只覆盖变更过的票，不覆盖未变更的；
 * - 同一张票取更新时间较新的一份，窗口重叠导致的重复不会产生两行；
 * - 窗口外被更新的票会接在末尾：它现在属于最前面，不能丢。
 *
 * @param base - 上次拉到的票。
 * @param changes - 增量窗口内变更过的票。
 * @returns 合并后的票。
 */
export function mergeTickets(base: readonly Ticket[], changes: readonly Ticket[]): Ticket[] {
  const positions = new Map<string, number>()
  const merged: Ticket[] = []

  for (const ticket of base) {
    if (!positions.has(ticket.ref)) positions.set(ticket.ref, merged.length)
    merged.push(ticket)
  }

  for (const change of changes) {
    const at = positions.get(change.ref)
    if (at === undefined) {
      positions.set(change.ref, merged.length)
      merged.push(change)
      continue
    }
    const existing = merged[at]
    if (existing !== undefined && isNewer(change, existing)) merged[at] = change
  }

  return merged
}

/**
 * 判断一张票是否比另一张更新。时间相同时以增量为准：增量是刚拉回来的，
 * 同一时刻的两份数据以新拉到的这份为准。
 */
function isNewer(candidate: Ticket, current: Ticket): boolean {
  const left = timestamp(candidate.updatedAt)
  const right = timestamp(current.updatedAt)
  if (left === undefined || right === undefined) return candidate.updatedAt >= current.updatedAt
  return left >= right
}

/** 把更新时间解析成毫秒时间戳；解析不了时返回 undefined。 */
function timestamp(value: string): number | undefined {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}
