/**
 * 列表布局的纯逻辑：把已经筛选、排序好的可见票构造成渲染行。
 *
 * 输入只有可见票与折叠集合，不读快照、不发请求、不碰 React：
 * 循环、自引用、缺失父级与深层嵌套都能单独测。
 *
 * 父子关系只用于组织与展示：行顺序仍服从调用方传入的排序，
 * 子票按输入顺序聚在父票下，判定、统计与筛选完全不经过这里。
 */
import type { TicketSnapshot } from '../protocol/tracker.ts'

/** 列表布局：平铺或父子。 */
export type TicketLayout = 'flat' | 'hierarchy'

/** 渲染一行所需的全部信息。 */
export interface TicketTreeRow {
  readonly ticket: TicketSnapshot
  /** 层级深度；平铺模式恒为 0。 */
  readonly depth: number
  /** 当前可见树里是否有子票（按当前筛选计算）。 */
  readonly hasChildren: boolean
  /** 这一行是否展开；叶子恒为 true。 */
  readonly expanded: boolean
  /**
   * 父级引用存在、但父票不在当前可见票里。
   * 父级可能被筛选掉、还没加载、在别的仓库，或是 GitLab epic。
   */
  readonly parentOutsideView: boolean
  /** 当前可见树里挂在这一行下面的全部后代数。 */
  readonly descendantCount: number
}

/**
 * 把可见票转成渲染行。
 * @param tickets - 已经按当前条件筛选、排序好的票。
 * @param layout - 平铺或父子。
 * @param collapsed - 会话内折叠的父票 `ref` 集合。
 * @returns 按渲染顺序排列的行；平铺时每张票一行。
 */
export function buildTicketRows(
  tickets: readonly TicketSnapshot[],
  layout: TicketLayout,
  collapsed: ReadonlySet<string>,
): readonly TicketTreeRow[] {
  if (layout === 'flat') {
    return tickets.map((ticket) => ({
      ticket,
      depth: 0,
      hasChildren: false,
      expanded: true,
      parentOutsideView: false,
      descendantCount: 0,
    }))
  }

  const byRef = new Map(tickets.map((ticket) => [ticket.ref, ticket]))
  const parentOf = new Map<string, string>()
  for (const ticket of tickets) {
    if (ticket.parent !== undefined) parentOf.set(ticket.ref, ticket.parent)
  }

  // 环上的票（含自引用）提升为顶层行，不递归、不丢票。
  const cyclic = cyclicRefs(tickets, byRef, parentOf)
  const roots: TicketSnapshot[] = []
  const children = new Map<string, TicketSnapshot[]>()

  for (const ticket of tickets) {
    const parent = parentOf.get(ticket.ref)
    if (
      parent === undefined ||
      parent === ticket.ref ||
      cyclic.has(ticket.ref) ||
      !byRef.has(parent)
    ) {
      roots.push(ticket)
      continue
    }
    const siblings = children.get(parent)
    if (siblings === undefined) children.set(parent, [ticket])
    else siblings.push(ticket)
  }

  const rows: TicketTreeRow[] = []
  const visit = (ticket: TicketSnapshot, depth: number): void => {
    const kids = children.get(ticket.ref) ?? []
    const expanded = !collapsed.has(ticket.ref)
    const parent = parentOf.get(ticket.ref)
    rows.push({
      ticket,
      depth,
      hasChildren: kids.length > 0,
      expanded: kids.length === 0 ? true : expanded,
      parentOutsideView:
        parent !== undefined &&
        parent !== ticket.ref &&
        !cyclic.has(ticket.ref) &&
        !byRef.has(parent),
      descendantCount: countDescendants(ticket.ref, children),
    })
    if (!expanded) return
    for (const child of kids) visit(child, depth + 1)
  }

  for (const root of roots) visit(root, 0)
  return rows
}

/**
 * 从概览定位一张票时要展开的祖先链。
 * @param tickets - 当前可见票。
 * @param focused - 要定位的票引用；没有时返回空数组。
 * @returns 从直接父级到根的祖先引用；遇到环或缺失父级时停止。
 */
export function ancestorRefs(
  tickets: readonly TicketSnapshot[],
  focused: string | null | undefined,
): readonly string[] {
  if (focused === null || focused === undefined) return []

  const byRef = new Map(tickets.map((ticket) => [ticket.ref, ticket]))
  const start = byRef.get(focused)
  if (start === undefined) return []

  const ancestors: string[] = []
  const seen = new Set<string>([focused])
  let cursor = start.parent
  while (cursor !== undefined && byRef.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor)
    ancestors.push(cursor)
    cursor = byRef.get(cursor)?.parent
  }
  return ancestors
}

/**
 * 把定位票的祖先链从折叠集合里移除。
 * @param tickets - 当前可见票。
 * @param collapsed - 当前折叠集合。
 * @param focused - 要定位的票引用。
 * @returns 新的折叠集合；没有需要展开的祖先时原样返回。
 */
export function expandAncestors(
  tickets: readonly TicketSnapshot[],
  collapsed: ReadonlySet<string>,
  focused: string | null | undefined,
): ReadonlySet<string> {
  const ancestors = ancestorRefs(tickets, focused)
  let next: Set<string> | undefined
  for (const ref of ancestors) {
    if (!collapsed.has(ref)) continue
    next ??= new Set(collapsed)
    next.delete(ref)
  }
  return next ?? collapsed
}

/** 找出所有位于环上的票；自引用也算一环。 */
function cyclicRefs(
  tickets: readonly TicketSnapshot[],
  byRef: ReadonlyMap<string, TicketSnapshot>,
  parentOf: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const cyclic = new Set<string>()

  for (const ticket of tickets) {
    const positions = new Map<string, number>()
    const chain: string[] = []
    let cursor: string | undefined = ticket.ref

    while (cursor !== undefined && byRef.has(cursor)) {
      const seenAt = positions.get(cursor)
      if (seenAt !== undefined) {
        for (let index = seenAt; index < chain.length; index += 1) {
          const ref = chain[index]
          if (ref !== undefined) cyclic.add(ref)
        }
        break
      }
      positions.set(cursor, chain.length)
      chain.push(cursor)
      cursor = parentOf.get(cursor)
    }
  }
  return cyclic
}

/** 数一张票下面全部可见的后代数；children 图已经排除环，不会递归不终止。 */
function countDescendants(
  ref: string,
  children: ReadonlyMap<string, readonly TicketSnapshot[]>,
): number {
  let count = 0
  for (const child of children.get(ref) ?? []) {
    count += 1 + countDescendants(child.ref, children)
  }
  return count
}
