/**
 * 解析 `gh api graphql` 的工单输出。输入是录制或真实的 JSON 文本，
 * 不在这里发起任何请求。
 */
import { readAuthor, readAuthors, readLogin, readLogins, type AuthorFields } from '../../core/author.ts'
import { isRecord } from '../../core/json.ts'
import {
  invalidDetail,
  readOptionalString,
  readRequiredString,
  sortCommentsByTime,
} from '../../core/ticket-detail.ts'
import type {
  Ticket,
  TicketAuthor,
  TicketComment,
  TicketState,
} from '../../core/ticket.ts'
import { TrackerError } from '../../core/tracker-error.ts'

/**
 * GraphQL 里的用户字段。列表、详情、分配人与评论作者共用这一份选择集，
 * 少写一处就会让某个位置退回首字母色块。
 */
export const GITHUB_USER_FIELDS = 'login avatarUrl ... on User { name }'

/** GitHub GraphQL 用户对象里的字段名。 */
const AUTHOR_FIELDS: AuthorFields = {
  login: 'login',
  displayName: 'name',
  avatarUrl: 'avatarUrl',
}

/** 一次 GraphQL 解析的结果。 */
export interface ParsedIssues {
  readonly total: number
  readonly tickets: readonly Ticket[]
  /** 当前登录用户的登录名；响应里没有时为 null。 */
  readonly viewer: string | null
  /** 还有下一页时给出的游标；缺省表示这一份已经覆盖全部。 */
  readonly nextCursor?: string
}

/** 一次增量 GraphQL 解析的结果。 */
export interface ParsedChanges {
  readonly tickets: readonly Ticket[]
  /**
   * 是否被单页上限截断。为 true 时这份增量不完整，
   * 宿主要退回全量重拉，不能拿它当完整结果。
   */
  readonly truncated: boolean
  /** 仓库总票数；后端给不出时缺席，宿主沿用上次的总数。 */
  readonly total?: number
  /** 当前登录用户的登录名；响应里没有时为 null。 */
  readonly viewer: string | null
}

/**
 * 从 GraphQL 响应里取出总数、工单与下一页游标。
 * @param output - `gh api graphql` 的标准输出。
 * @returns 仓库总数、实际解析到的工单与下一页游标。
 * @throws {TrackerError} 输出不是 JSON、仓库不存在、工单字段不合法或缺少分页信息。
 */
export function parseIssueGraphql(output: string): ParsedIssues {
  const payload = parseJson(output, 'gh 返回的不是有效 JSON')
  const repository = readRepository(payload)
  const repositoryName = readRepositoryName(repository)
  const issues = readIssues(repository)

  const nodes = issues.nodes
  if (!Array.isArray(nodes)) throw invalid('仓库的 issues.nodes 不是数组')

  const tickets = nodes.map((node, index) => parseIssueNode(node, index, repositoryName))
  const total = issues.totalCount
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
    throw invalid('仓库的 issues.totalCount 不是非负整数')
  }

  const nextCursor = readNextCursor(issues)
  const viewer = readViewer(payload)
  return nextCursor === undefined
    ? { total, tickets, viewer }
    : { total, tickets, viewer, nextCursor }
}

/**
 * 解析增量 GraphQL 响应。
 *
 * 与列表解析共用同一份字段定义：增量与全量必须覆盖同一批工单，
 * 只有时间窗口不同，否则合并出来的结果不可能与全量重拉一致。
 * @param output - `gh api graphql` 的标准输出。
 * @returns 变更过的工单、是否被截断与仓库总票数。
 * @throws {TrackerError} 输出不是 JSON、仓库不存在或工单字段不合法。
 */
export function parseIssueChangesGraphql(output: string): ParsedChanges {
  const payload = parseJson(output, 'gh 返回的不是有效 JSON')
  const repository = readRepository(payload)
  const repositoryName = readRepositoryName(repository)
  const issues = readIssues(repository)

  const nodes = issues.nodes
  if (!Array.isArray(nodes)) throw invalid('仓库的 issues.nodes 不是数组')

  const tickets = nodes.map((node, index) => parseIssueNode(node, index, repositoryName))
  const total = readRepositoryTotal(repository)

  return {
    tickets,
    truncated: readHasNextPage(issues),
    viewer: readViewer(payload),
    ...(total === undefined ? {} : { total }),
  }
}

/**
 * 列表的下一页游标。
 *
 * 列表查询固定请求 `pageInfo { hasNextPage endCursor }`；拿不到分页信息说明
 * 响应不是这份查询的结果，按数据格式错误处理——静默当成「没有下一页」
 * 会让列表永远停在第一页，正是这个接口要避免的情况。
 * @param issues - 仓库的 issues 连接。
 * @returns 下一页游标；没有下一页时 undefined。
 */
function readNextCursor(issues: Record<string, unknown>): string | undefined {
  const pageInfo = issues.pageInfo
  if (!isRecord(pageInfo)) throw invalid('仓库的 issues.pageInfo 缺失')

  const hasNextPage = pageInfo.hasNextPage
  if (typeof hasNextPage !== 'boolean') {
    throw invalid('仓库的 issues.pageInfo.hasNextPage 不是布尔值')
  }
  if (!hasNextPage) return undefined

  const endCursor = pageInfo.endCursor
  if (typeof endCursor !== 'string' || endCursor.length === 0) {
    throw invalid('仓库还有下一页，但 issues.pageInfo.endCursor 不是非空字符串')
  }
  return endCursor
}

/**
 * 增量结果是否被单页上限截断。
 *
 * 用 GitHub 自己给的 `hasNextPage` 判断，不用「返回条数 == 上限」那种猜法：
 * 最后一页可能刚好是满页，猜法会误报成截断，让宿主白跑一次全量重拉。
 * 拿不到分页信息时按「可能不完整」处理：宿主退回全量重拉总比漏票好。
 */
function readHasNextPage(issues: Record<string, unknown>): boolean {
  const pageInfo = issues.pageInfo
  if (!isRecord(pageInfo)) return true

  const hasNextPage = pageInfo.hasNextPage
  if (typeof hasNextPage !== 'boolean') {
    throw invalid('仓库的 issues.pageInfo.hasNextPage 不是布尔值')
  }
  return hasNextPage
}

/**
 * 仓库总票数。
 *
 * 增量查询里 `issues.totalCount` 会跟着 `filterBy` 一起过滤，
 * 那是「这次窗口内变更了多少张票」，不是仓库的票数；
 * 仓库总数另取一份未过滤的连接，用它更新宿主显示的总数。
 */
function readRepositoryTotal(repository: Record<string, unknown>): number | undefined {
  const totals = repository.repositoryTotal
  if (!isRecord(totals)) return undefined

  const total = totals.totalCount
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) return undefined
  return total
}

function parseIssueNode(value: unknown, index: number, repository: string | undefined): Ticket {
  if (!isRecord(value)) throw invalid(`第 ${String(index + 1)} 张票不是对象`)
  const number = value.number
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) {
    throw invalid(`第 ${String(index + 1)} 张票的编号不合法`)
  }

  const title = readString(value.title, `第 ${String(number)} 张票的标题`)
  const state = readState(value.state, number)
  const closedAt = readClosedAt(value.closedAt, number)
  const parent = readParent(value.parent, repository)
  const url = readOptionalString(value.url)

  return {
    ref: `#${String(number)}`,
    number,
    title,
    state,
    labels: readLabels(value.labels),
    author: readAuthor(value.author, AUTHOR_FIELDS),
    assignees: readAssigneeLogins(value.assignees),
    createdAt: readString(value.createdAt, `第 ${String(number)} 张票的创建时间`),
    updatedAt: readString(value.updatedAt, `第 ${String(number)} 张票的更新时间`),
    openBlockers: readOpenBlockers(value.issueDependenciesSummary),
    ...(closedAt === undefined ? {} : { closedAt }),
    ...(parent === undefined ? {} : { parent }),
    ...(url === null ? {} : { url }),
  }
}

/**
 * 列表里分配人的连接（`{ nodes: [...] }`）只带登录名。
 * 缺字段或形状不对时按空数组处理，与创建人的容错口径一致。
 * @param value - GraphQL 返回的 assignees 连接。
 * @returns 登录名数组。
 */
function readAssigneeLogins(value: unknown): readonly string[] {
  if (!isRecord(value)) return []
  return readLogins(value.nodes, AUTHOR_FIELDS)
}

/**
 * 仓库的 `nameWithOwner`。父票要靠它区分同仓库与跨仓库：
 * 跨仓库父票必须保留完整引用，绝不能把裸编号误配到本仓库同号票上。
 * 响应里没有这个字段时无法安全比较，所有父级引用按缺失处理。
 */
function readRepositoryName(repository: Record<string, unknown>): string | undefined {
  const name = repository.nameWithOwner
  return typeof name === 'string' && name.length > 0 ? name : undefined
}

/**
 * 父票引用：同仓库存 `#编号`，跨仓库存 `owner/name#编号`。
 * 父票为空、字段不合法或仓库不可见时按无父级处理：层级是增强信息，
 * 不能因为它拖垮整个列表。
 */
function readParent(value: unknown, repository: string | undefined): string | undefined {
  if (repository === undefined || !isRecord(value)) return undefined

  const number = value.number
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) return undefined

  const parentRepository = value.repository
  if (!isRecord(parentRepository)) return undefined

  const nameWithOwner = parentRepository.nameWithOwner
  if (typeof nameWithOwner !== 'string' || nameWithOwner.length === 0) return undefined

  return nameWithOwner === repository
    ? `#${String(number)}`
    : `${nameWithOwner}#${String(number)}`
}

function readRepository(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) throw invalid('gh 输出的顶层不是对象')
  const data = payload.data
  if (!isRecord(data)) throw invalid('gh 输出缺少 data')
  const repository = data.repository
  if (!isRecord(repository)) {
    throw new TrackerError('fetch-failed', 'GitHub 上找不到这个仓库，或当前账号没有访问权限。')
  }
  return repository
}

/**
 * 当前登录用户：GraphQL 根字段 `viewer.login`。
 * 缺失或形状不对时按没有身份处理，不让身份查询影响整张列表。
 * @param payload - 已解析的 GraphQL 响应。
 * @returns 登录名，或 null。
 */
function readViewer(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  const data = payload.data
  if (!isRecord(data)) return null
  return readLogin(data.viewer, 'login')
}

function readIssues(repository: Record<string, unknown>): Record<string, unknown> {
  const issues = repository.issues
  if (!isRecord(issues)) throw invalid('仓库缺少 issues 字段')
  return issues
}

function readState(value: unknown, number: number): TicketState {
  const normalized = typeof value === 'string' ? value.toLowerCase() : value
  if (normalized === 'open') return 'open'
  if (normalized === 'closed') return 'closed'
  throw invalid(`第 ${String(number)} 张票的状态不合法`)
}

function readLabels(value: unknown): readonly string[] {
  if (!isRecord(value)) return []
  const nodes = value.nodes
  if (!Array.isArray(nodes)) return []

  const labels: string[] = []
  for (const node of nodes) {
    if (!isRecord(node)) continue
    const name = node.name
    if (typeof name === 'string' && name.length > 0) labels.push(name)
  }
  return labels
}

/**
 * `issueDependenciesSummary.blockedBy` 是未关闭阻塞票的数量，0 表示可以开工。
 * 字段缺失时按 0 处理：没有依赖的票在 GitHub 上就是不带汇总。
 */
function readOpenBlockers(value: unknown): number {
  if (value === undefined || value === null) return 0
  if (!isRecord(value)) throw invalid('issueDependenciesSummary 不是对象')
  const blockedBy = value.blockedBy
  if (blockedBy === undefined || blockedBy === null) return 0
  if (typeof blockedBy !== 'number' || !Number.isFinite(blockedBy) || blockedBy < 0) {
    throw invalid('issueDependenciesSummary.blockedBy 不是非负数')
  }
  return blockedBy
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(`${field} 不是非空字符串`)
  }
  return value
}

/**
 * 关闭时间：开放票为 null，已关闭票是 ISO 字符串。
 * @param value - GraphQL 返回的 `closedAt`。
 * @param number - 工单编号，用于错误信息。
 * @returns 关闭时间；开放票缺席。
 */
function readClosedAt(value: unknown, number: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(`第 ${String(number)} 张票的关闭时间不合法`)
  }
  return value
}

function parseJson(output: string, message: string): unknown {
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new TrackerError('fetch-failed', message, { cause: error })
  }
}

function invalid(message: string): TrackerError {
  return new TrackerError('fetch-failed', `工单数据格式不正确：${message}`)
}

/**
 * 详情与变更共用的工单字段。详情多一页评论，变更只需要这些当前值。
 */
export interface ParsedIssueCore {
  readonly number: number
  readonly title: string
  readonly body: string
  readonly state: TicketState
  readonly labels: readonly string[]
  readonly author: TicketAuthor | null
  readonly assignees: readonly TicketAuthor[]
  readonly url: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/** 一页详情：工单字段加这一页的评论与分页信息。 */
export interface ParsedDetailPage extends ParsedIssueCore {
  readonly comments: readonly TicketComment[]
  readonly hasNextPage: boolean
  /** 下一页游标；没有下一页时为 null。 */
  readonly endCursor: string | null
}

/**
 * 解析只取当前值的详情响应，用于变更前读取现有标签、分配人与状态。
 * @param output - `gh api graphql` 的标准输出。
 * @returns 工单当前值。
 * @throws {TrackerError} 工单不存在、输出不是 JSON 或字段不合法。
 */
export function parseIssueCore(output: string): ParsedIssueCore {
  return readIssueCore(readIssuePayload(parseJson(output, 'gh 返回的不是有效 JSON')))
}

/**
 * 解析一页详情：工单字段、这一页的评论与是否还有下一页。
 * @param output - `gh api graphql` 的标准输出。
 * @returns 一页详情。
 * @throws {TrackerError} 工单不存在、输出不是 JSON 或字段不合法。
 */
export function parseIssueDetailPage(output: string): ParsedDetailPage {
  const issue = readIssuePayload(parseJson(output, 'gh 返回的不是有效 JSON'))
  const pageInfo = readCommentPageInfo(issue.comments)

  return {
    ...readIssueCore(issue),
    comments: readCommentNodes(issue.comments),
    hasNextPage: pageInfo.hasNextPage,
    endCursor: pageInfo.endCursor,
  }
}

/** 取出 `data.repository.issue`；仓库不可见与工单不存在是两种不同的结果。 */
function readIssuePayload(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) throw invalidDetail('gh 输出的顶层不是对象')
  const data = payload.data
  if (!isRecord(data)) throw invalidDetail('gh 输出缺少 data')
  const repository = data.repository
  if (!isRecord(repository)) {
    throw new TrackerError('fetch-failed', 'GitHub 上找不到这个仓库，或当前账号没有访问权限。')
  }

  const issue = repository.issue
  if (issue === null || issue === undefined) {
    throw new TrackerError('ticket-not-found', '找不到这张工单，它可能已被删除。')
  }
  if (!isRecord(issue)) throw invalidDetail('issue 不是对象')
  return issue
}

function readIssueCore(issue: Record<string, unknown>): ParsedIssueCore {
  const number = readPositiveInteger(issue.number)

  return {
    number,
    title: readRequiredString(issue.title, '标题'),
    body: typeof issue.body === 'string' ? issue.body : '',
    state: readState(issue.state, number),
    labels: readLabels(issue.labels),
    author: readAuthor(issue.author, AUTHOR_FIELDS),
    assignees: readUserNodes(issue.assignees),
    url: readOptionalString(issue.url),
    createdAt: readRequiredString(issue.createdAt, '创建时间'),
    updatedAt: readRequiredString(issue.updatedAt, '更新时间'),
  }
}

/** 分配人连接（`{ nodes: [...] }`）里的用户。 */
function readUserNodes(value: unknown): readonly TicketAuthor[] {
  if (!isRecord(value)) return []
  return readAuthors(value.nodes, AUTHOR_FIELDS)
}

function readCommentNodes(value: unknown): readonly TicketComment[] {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return []

  const comments: TicketComment[] = []
  for (const node of value.nodes) {
    if (!isRecord(node)) continue
    const body = typeof node.body === 'string' ? node.body : ''
    if (body.length === 0) continue
    comments.push({
      author: readAuthor(node.author, AUTHOR_FIELDS),
      body,
      createdAt: readOptionalString(node.createdAt),
    })
  }
  return sortCommentsByTime(comments)
}

function readCommentPageInfo(value: unknown): {
  readonly hasNextPage: boolean
  readonly endCursor: string | null
} {
  if (!isRecord(value)) throw invalidDetail('缺少评论连接')
  const pageInfo = value.pageInfo
  if (!isRecord(pageInfo)) throw invalidDetail('评论缺少 pageInfo')

  const hasNextPage = pageInfo.hasNextPage
  if (typeof hasNextPage !== 'boolean') {
    throw invalidDetail('评论的 pageInfo.hasNextPage 不是布尔值')
  }
  return { hasNextPage, endCursor: readOptionalString(pageInfo.endCursor) }
}

function readPositiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw invalidDetail('编号不是正整数')
  }
  return value
}
