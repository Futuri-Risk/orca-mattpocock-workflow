/**
 * 工单引用的纯函数：在快照里按引用找行，把阻塞引用换成读取详情用的编号。
 *
 * 这里不依赖任何视图：列表、详情与返回栈都按同一份规则解析引用。
 */
import type { TicketSnapshot } from '../protocol/tracker.ts'

/**
 * 按引用在当前快照里找行；没有快照或引用不在窗口里时为 null。
 * @param tickets - 当前快照的全部行。
 * @param ref - 工单引用。
 * @returns 快照行；找不到时为 null。
 */
export function findSnapshotTicket(
  tickets: readonly TicketSnapshot[] | undefined,
  ref: string,
): TicketSnapshot | null {
  return tickets?.find((ticket) => ticket.ref === ref) ?? null
}

/**
 * 把阻塞引用换成读取详情用的数字编号：远端是 `#15`，本地 Markdown 路径没有编号。
 * @param ref - 阻塞引用。
 * @returns 数字编号；不是 `#数字` 形式时为 null。
 */
export function blockerNumber(ref: string): number | null {
  const match = /^#(\d+)$/.exec(ref)
  if (match === null) return null
  const number = Number.parseInt(match[1] ?? '', 10)
  return Number.isSafeInteger(number) ? number : null
}
