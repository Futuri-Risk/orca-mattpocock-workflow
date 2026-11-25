/**
 * 面板的展示逻辑：统计、过滤、排序。纯函数，不依赖宿主，也不重复判定规则——
 * 每张票的 `status` 已由宿主附上。
 */
import type { TicketSnapshot, TicketStatus } from '../protocol/tracker.ts'

/** 过滤条件。`open` 包含可接、阻塞和其他开放。 */
export type TicketFilter = 'all' | 'open' | 'closed' | 'blocked' | 'ready'

/** 排序字段。 */
export type TicketSortKey = 'updated' | 'created' | 'number' | 'title' | 'status'

/** 排序方向。 */
export type SortDirection = 'asc' | 'desc'

/**
 * 人员筛选：两个独立开关。都关时不按人员过滤；
 * 只开一个时只看对应角色；两个都开时取并集（分配给我 ∪ 我创建）。
 */
export interface PeopleFilter {
  readonly assignedToMe: boolean
  readonly createdByMe: boolean
}

/** 两个人员开关的字段名；界面切换与偏好写入共用。 */
export type PersonFilterKey = keyof PeopleFilter

/** 状态筛选之后，两个人员角色各自的数量。 */
export interface PeopleCounts {
  readonly assignedToMe: number
  readonly createdByMe: number
}

/** 一次列表展示的全部筛选条件。 */
export interface TicketViewQuery {
  readonly filter: TicketFilter
  readonly sortKey: TicketSortKey
  readonly direction: SortDirection
  /** 当前登录用户；null 时人员开关视为关闭。 */
  readonly viewer: string | null
  readonly people: PeopleFilter
}

/** 列表展示结果：可见列表与两个人员计数。 */
export interface TicketView {
  readonly visible: readonly TicketSnapshot[]
  readonly counts: PeopleCounts
}

/** “可接 / 阻塞 / 其他开放 / 已关闭”四类数量。 */
export interface TicketCounts {
  readonly ready: number
  readonly blocked: number
  readonly open: number
  readonly closed: number
}

/**
 * 统计四类数量。四类相加等于已加载票数，顶部计数才对得上列表。
 * @param tickets - 已判定的工单。
 * @returns 四个计数。
 */
export function countTickets(tickets: readonly TicketSnapshot[]): TicketCounts {
  let ready = 0
  let blocked = 0
  let open = 0
  let closed = 0

  for (const ticket of tickets) {
    if (ticket.status === 'ready') ready += 1
    else if (ticket.status === 'blocked') blocked += 1
    else if (ticket.status === 'closed') closed += 1
    else open += 1
  }

  return { ready, blocked, open, closed }
}

/**
 * 筛选段上的计数，与 `filterTickets` 的口径一一对应：
 * 「全部」是全部票数，「Open」是所有未关闭票（可接 + 阻塞 + 其他开放），
 * 其余三项各取同类计数。全部数字都从 `countTickets` 派生，
 * 因此每个计数都等于点开该段后列表的行数。
 * @param counts - `countTickets` 的四类计数。
 * @returns 按筛选键的计数。
 */
export function countByFilter(counts: TicketCounts): Readonly<Record<TicketFilter, number>> {
  const all = counts.ready + counts.blocked + counts.open + counts.closed
  return {
    all,
    open: all - counts.closed,
    closed: counts.closed,
    blocked: counts.blocked,
    ready: counts.ready,
  }
}

/**
 * 按状态过滤。
 * @param tickets - 已判定的工单。
 * @param filter - 过滤条件。
 * @returns 保持原顺序的新数组。
 */
export function filterTickets(
  tickets: readonly TicketSnapshot[],
  filter: TicketFilter,
): readonly TicketSnapshot[] {
  switch (filter) {
    case 'all':
      return [...tickets]
    case 'open':
      return tickets.filter((ticket) => ticket.state === 'open')
    case 'closed':
      return tickets.filter((ticket) => ticket.status === 'closed')
    case 'blocked':
      return tickets.filter((ticket) => ticket.status === 'blocked')
    case 'ready':
      return tickets.filter((ticket) => ticket.status === 'ready')
  }
}

/**
 * 计算列表展示结果。组合顺序固定为：状态过滤 → 人员过滤 → 排序；
 * 状态过滤只算一次，人员计数与最终列表共用这份中间结果。
 *
 * 人员计数按当前状态筛选后的集合计算，两个角色各自独立于另一个开关；
 * 状态分段控件与统计仍基于整份快照，不随人员筛选变化。
 * @param tickets - 已判定的工单（整份已加载快照）。
 * @param query - 状态、排序、当前用户与人员开关。
 * @returns 可见列表与两个人员计数。
 */
export function viewTickets(
  tickets: readonly TicketSnapshot[],
  query: TicketViewQuery,
): TicketView {
  const byStatus = filterTickets(tickets, query.filter)
  return {
    visible: sortTickets(
      filterByPeople(byStatus, query.viewer, query.people),
      query.sortKey,
      query.direction,
    ),
    counts: countPeople(byStatus, query.viewer),
  }
}

/**
 * 按人员维度过滤。当前用户为 null 时忽略开关（整行本来也不渲染）。
 * @param tickets - 状态筛选后的工单。
 * @param viewer - 当前登录用户。
 * @param people - 两个人员开关。
 * @returns 保持原顺序的新数组。
 */
function filterByPeople(
  tickets: readonly TicketSnapshot[],
  viewer: string | null,
  people: PeopleFilter,
): readonly TicketSnapshot[] {
  if (viewer === null || (!people.assignedToMe && !people.createdByMe)) return [...tickets]
  const target = viewer.toLowerCase()
  return tickets.filter((ticket) => {
    if (people.assignedToMe && assignedTo(ticket, target)) return true
    return people.createdByMe && createdBy(ticket, target)
  })
}

/**
 * 两个人员角色在给定集合里的数量。计数互不影响，也不看开关当前是否打开。
 * @param tickets - 状态筛选后的工单。
 * @param viewer - 当前登录用户；null 时两个计数都是 0。
 * @returns 分配给我与我创建的的数量。
 */
function countPeople(tickets: readonly TicketSnapshot[], viewer: string | null): PeopleCounts {
  if (viewer === null) return { assignedToMe: 0, createdByMe: 0 }

  const target = viewer.toLowerCase()
  let assignedToMe = 0
  let createdByMe = 0
  for (const ticket of tickets) {
    if (assignedTo(ticket, target)) assignedToMe += 1
    if (createdBy(ticket, target)) createdByMe += 1
  }
  return { assignedToMe, createdByMe }
}

/** 分配人里任意一个登录名与当前用户相同；`target` 已转小写。 */
function assignedTo(ticket: TicketSnapshot, target: string): boolean {
  return ticket.assignees.some((login) => login.toLowerCase() === target)
}

/** 创建人不为 null 且登录名与当前用户相同；后端匿名或没给创建人时不算。 */
function createdBy(ticket: TicketSnapshot, target: string): boolean {
  if (ticket.author === null) return false
  return ticket.author.login.toLowerCase() === target
}

/**
 * 按字段排序，相等时保持输入顺序。
 * @param tickets - 已判定的工单。
 * @param key - 排序字段。
 * @param direction - 升序或降序。
 * @returns 新数组。
 */
export function sortTickets(
  tickets: readonly TicketSnapshot[],
  key: TicketSortKey,
  direction: SortDirection,
): readonly TicketSnapshot[] {
  const factor = direction === 'asc' ? 1 : -1

  return [...tickets].sort((left, right) => {
    if (key === 'number') return compareByNumber(left, right, factor)
    if (key === 'status') return compareByStatus(left, right, factor)
    return factor * compareTickets(left, right, key)
  })
}

/**
 * 切换到某个排序键时的默认方向：标题与状态从升序看起，编号与时间从最大/最新看起。
 * @param key - 排序字段。
 * @returns 该字段的默认方向。
 */
export function defaultSortDirection(key: TicketSortKey): SortDirection {
  return key === 'title' || key === 'status' ? 'asc' : 'desc'
}

/**
 * “按编号”在混合数据下先分组：有数字编号的票永远在前，本地 Markdown 按 `ref`
 * 排在后；方向只作用于组内，避免降序时把本地票翻到最前面。
 */
function compareByNumber(left: TicketSnapshot, right: TicketSnapshot, factor: number): number {
  const group = numberGroup(left) - numberGroup(right)
  if (group !== 0) return group

  if (left.number !== null && right.number !== null) {
    return factor * (left.number - right.number)
  }
  return factor * left.ref.localeCompare(right.ref, 'en')
}

function numberGroup(ticket: TicketSnapshot): number {
  return ticket.number === null ? 1 : 0
}

/** 状态分组：可接、阻塞、其他开放、已关闭；组内沿用“按编号”的比较与分组。 */
const STATUS_RANK: Record<TicketStatus, number> = {
  ready: 0,
  blocked: 1,
  open: 2,
  closed: 3,
}

function compareByStatus(left: TicketSnapshot, right: TicketSnapshot, factor: number): number {
  const group = STATUS_RANK[left.status] - STATUS_RANK[right.status]
  if (group !== 0) return factor * group
  return compareByNumber(left, right, factor)
}

function compareTickets(
  left: TicketSnapshot,
  right: TicketSnapshot,
  key: Exclude<TicketSortKey, 'number' | 'status'>,
): number {
  switch (key) {
    case 'title':
      return left.title.localeCompare(right.title, 'zh-Hans')
    case 'created':
      return timestamp(left.createdAt) - timestamp(right.createdAt)
    case 'updated':
      return timestamp(left.updatedAt) - timestamp(right.updatedAt)
  }
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}
