/**
 * Gitea 工单后端：通过注入的 {@link CommandRunner} 调用 `git` 与 `tea`。
 *
 * - 只读：用 `tea api` 读仓库 issue 列表，`type=issues` 把 pull request 挡在接口外；
 * - 分页：总条数取自 `X-Total-Count`（`tea api --include` 写到标准错误里），
 *   按页拉到拿全为止；
 * - 阻塞：优先读 Gitea 原生 issue 依赖，只查开放的工单，并发有上限；
 *   仓库关闭了依赖功能（接口返回 404）时退回正文顶部的 `Blocked by:` 行；
 * - 父子：Gitea 没有原生子工单，父级来自子票正文第一个非空行的 `Part of #<n>`，
 *   在列表响应里解析，不额外请求；阻塞边不参与父子；
 * - 详情与变更在 `detail.ts`，只在打开详情或提交变更时执行。
 */
import {
  remoteBlockerRefs,
  resolveOpenBlockers,
  type NativeBlockers,
} from '../../core/blocked-by.ts'
import { mapWithConcurrency } from '../../core/concurrency.ts'
import { isRecord } from '../../core/json.ts'

import type {
  BlockerResolution,
  CommandRunner,
  SourceRevision,
  TicketReference,
  TicketState,
  Tracker,
  TrackerChanges,
  TrackerSnapshot,
} from '../../core/ticket.ts'
import { TrackerError } from '../../core/tracker-error.ts'
import { deleteGiteaTicket, readGiteaDeletePermission } from './delete.ts'
import { applyGiteaChanges, readGiteaDetail } from './detail.ts'
import { readGiteaOptions } from './options.ts'
import { parseCurrentLogin, parseDependencies, parseIssuesPage, type ParsedIssue } from './parse.ts'
import { callGiteaApi, ensureSuccess, readRepository, type GiteaRepository } from './shared.ts'

/** Gitea 后端依赖。 */
export interface GiteaTrackerDeps {
  readonly run: CommandRunner
  readonly now: () => number
  /** 单页大小；默认 50，与 Gitea 的默认返回上限一致。 */
  readonly pageSize?: number
  /** 并发查询依赖的上限。 */
  readonly concurrency?: number
}

const DEFAULT_PAGE_SIZE = 50
/** 补齐原生依赖的并发上限：与 GitLab 对齐，N 张开放票排成 ⌈N/8⌉ 波。 */
const DEFAULT_CONCURRENCY = 8
const MAX_PAGES = 200

/**
 * 创建 Gitea 工单后端。
 * @param deps - 命令执行器、时钟与可选的页大小、并发上限。
 * @returns 满足 core `Tracker` 契约的后端。
 */
export function createGiteaTracker(deps: GiteaTrackerDeps): Tracker {
  const pageSize = normalizePositive(deps.pageSize ?? DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE)
  const concurrency = normalizePositive(
    deps.concurrency ?? DEFAULT_CONCURRENCY,
    DEFAULT_CONCURRENCY,
  )
  const detailDeps = { run: deps.run, pageSize }

  return {
    async fetchSnapshot(workspaceRoot: string): Promise<TrackerSnapshot> {
      const repository = await readRepository(deps.run, workspaceRoot)
      // 身份、列表与远端版本并行发出：各自失败都不拖慢列表；版本读不到时快照照常，
      // 只是下一次刷新会退回全量。
      const viewer = readCurrentViewer(deps, workspaceRoot)
      const revision = readGiteaRevision(deps, workspaceRoot, repository)
      const issues = await readIssues(deps, workspaceRoot, repository, pageSize)
      const states = new Map<number, TicketState>()
      for (const issue of issues.items) {
        if (issue.ticket.number !== null) states.set(issue.ticket.number, issue.ticket.state)
      }

      // 首屏只等列表：原生依赖留给 resolveBlockers，阻塞数先按正文 `Blocked by:` 行回退。
      const tickets = issues.items.map((issue) => ({
        ...issue.ticket,
        ...resolveOpenBlockers({
          ticket: issue.ticket,
          nativeBlockers: undefined,
          text: issue.body,
          states,
        }),
      }))

      return {
        repository: `${repository.owner}/${repository.name}`,
        fetchedAt: deps.now(),
        loaded: tickets.length,
        total: Math.max(issues.total ?? tickets.length, tickets.length),
        tickets,
        viewer: await viewer,
        // Gitea 没有原生子工单；父级来自子票正文首行的 `Part of #<n>` 约定。
        hierarchy: 'convention',
        revision: await revision,
      }
    },

    async fetchChanges(
      workspaceRoot: string,
      since: number,
    ): Promise<TrackerChanges> {
      return readGiteaChanges(deps, workspaceRoot, pageSize, since)
    },

    async resolveBlockers(
      workspaceRoot: string,
      targets: readonly TicketReference[],
    ): Promise<BlockerResolution> {
      const open = targets.filter(
        (target): target is TicketReference & { readonly number: number } => target.number !== null,
      )
      if (open.length === 0) return { open: new Map(), blockedBy: new Map() }

      const repository = await readRepository(deps.run, workspaceRoot)
      try {
        const counts = await mapWithConcurrency(open, concurrency, async (target) => ({
          ref: target.ref,
          blockedBy: await readDependencies(
            deps,
            workspaceRoot,
            repository,
            target.number,
            pageSize,
          ),
        }))

        const native = new Map<string, number>()
        const blockedBy = new Map<string, readonly string[]>()
        for (const entry of counts) {
          native.set(entry.ref, entry.blockedBy.open)
          if (entry.blockedBy.refs.length > 0) {
            blockedBy.set(entry.ref, remoteBlockerRefs(entry.blockedBy.refs))
          }
        }
        return { open: native, blockedBy }
      } catch (error) {
        // 实例或仓库关闭依赖功能：整组按“没有原生依赖”处理，正文回退仍然有效。
        if (error instanceof DependenciesUnavailable) {
          return { open: new Map(), blockedBy: new Map() }
        }
        throw error
      }
    },

    fetchDetail: (workspaceRoot, reference) =>
      readGiteaDetail(detailDeps, workspaceRoot, reference),

    updateTicket: (workspaceRoot, reference, patch) =>
      applyGiteaChanges(detailDeps, workspaceRoot, reference, patch),

    fetchOptions: (workspaceRoot) => readGiteaOptions(deps, workspaceRoot),

    canDeleteTickets: (workspaceRoot) => readGiteaDeletePermission(deps, workspaceRoot),

    deleteTicket: (workspaceRoot, reference) => deleteGiteaTicket(deps, workspaceRoot, reference),
  }
}

/**
 * 读取某个时刻之后变更过的工单。
 *
 * 与列表查询走同一个接口、同一套过滤条件，只多一个时间窗口。
 * 每次刷新都真正扫描窗口，不靠远端版本号短路。
 */
async function readGiteaChanges(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
  pageSize: number,
  since: number,
): Promise<TrackerChanges> {
  if (!Number.isFinite(since)) {
    throw new TrackerError('fetch-failed', '增量窗口的起点不是有效时间戳。')
  }

  const repository = await readRepository(deps.run, workspaceRoot)
  // 版本查询与列表共用同一个仓库识别；版本读不到时 revision 为 null，宿主退回全量。
  const revision = await readGiteaRevision(deps, workspaceRoot, repository)

  const viewer = readCurrentViewer(deps, workspaceRoot)
  const issues = await readIssues(deps, workspaceRoot, repository, pageSize, since)

  const states = new Map<number, TicketState>()
  for (const issue of issues.items) {
    if (issue.ticket.number !== null) states.set(issue.ticket.number, issue.ticket.state)
  }

  // 增量同样只回正文回退结果；原生依赖由补齐阶段按开放票统一读取，
  // 刷新成本因此不随开放票总数增长。
  const resolvedTickets = issues.items.map((issue) => ({
    ...issue.ticket,
    ...resolveOpenBlockers({
      ticket: issue.ticket,
      nativeBlockers: undefined,
      text: issue.body,
      states,
    }),
  }))

  const login = await viewer
  return {
    tickets: resolvedTickets,
    truncated: issues.truncated,
    // 变更查询的 X-Total-Count 是过滤后的条数；仓库总数只认版本查询的计数。
    ...(revision === null ? {} : { total: revision.total }),
    ...(login === null ? {} : { viewer: login }),
    hierarchy: 'convention',
    revision,
  }
}

/**
 * 读取 Gitea 的远端版本：一次 `limit=1` 的计数查询同时给出总数与最新更新时间。
 * 依赖功能、列表权限或响应头缺失时返回 null，宿主据此退回全量。
 */
async function readGiteaRevision(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
  repository: GiteaRepository,
): Promise<SourceRevision | null> {
  try {
    const [response, repositoryUpdatedAt] = await Promise.all([
      callGiteaApi(deps.run, workspaceRoot, revisionEndpoint(repository)),
      readRepositoryUpdatedAt(deps, workspaceRoot, repository),
    ])
    if (response.status >= 400) return null
    const total = response.total
    if (total === undefined) return null
    if (total === 0) return { id: '0:', total }
    const latest = parseIssuesPage(response.body, repository.avatarBaseUrl)[0]?.ticket.updatedAt
    if (latest === undefined) return null
    // 仓库 updated_at 捕捉仓库级变更；最新工单 updatedAt 捕捉 issue 编辑与状态变化。
    // 两者都给不出时才退回「总数 + 最新工单」。
    const id =
      repositoryUpdatedAt === undefined
        ? `${String(total)}:${latest}`
        : `${repositoryUpdatedAt}:${String(total)}:${latest}`
    return { id, total }
  } catch {
    return null
  }
}

/**
 * 读取仓库的 `updated_at`。仓库接口不可用或响应不是对象时返回 undefined：
 * 版本号仍有「总数 + 最新工单」可用，不让一次附属查询挡住刷新。
 */
async function readRepositoryUpdatedAt(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
  repository: GiteaRepository,
): Promise<string | undefined> {
  try {
    const response = await callGiteaApi(
      deps.run,
      workspaceRoot,
      `/repos/${repository.owner}/${repository.name}`,
    )
    if (response.status >= 400) return undefined
    const payload: unknown = JSON.parse(response.body)
    if (!isRecord(payload)) return undefined
    const updatedAt = payload.updated_at
    return typeof updatedAt === 'string' && updatedAt.length > 0 ? updatedAt : undefined
  } catch {
    return undefined
  }
}

/**
 * 读取当前登录名。身份是列表的附属信息：命令失败或响应不可识别时返回 null，
 * 不把整张列表当成失败。
 * @param deps - 命令执行器。
 * @param workspaceRoot - 工作区根目录。
 * @returns 登录名，或 null。
 */
async function readCurrentViewer(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
): Promise<string | null> {
  try {
    const response = await callGiteaApi(deps.run, workspaceRoot, '/user')
    return parseCurrentLogin(response.body)
  } catch {
    return null
  }
}

/**
 * 读取一页页的工单。
 *
 * `since` 给了就只取该时刻之后更新过的票：同一路径、同样的过滤条件，
 * 只多一个时间窗口，这样增量与全量覆盖的是同一批工单。
 */
async function readIssues(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
  repository: GiteaRepository,
  pageSize: number,
  since?: number,
): Promise<{
  readonly items: ParsedIssue[]
  readonly total: number | undefined
  readonly truncated: boolean
}> {
  const items: ParsedIssue[] = []
  let total: number | undefined
  let truncated = false

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await callGiteaApi(
      deps.run,
      workspaceRoot,
      issuesEndpoint(repository, pageSize, page, since),
    )
    ensureSuccess(response, '读取 Gitea 工单')

    const parsed = parseIssuesPage(response.body, repository.avatarBaseUrl)
    items.push(...parsed)
    total ??= response.total

    // 有总条数就按条数收口；没有时只能一直翻到空页，宁可多一次请求，也不提前截断。
    if (total !== undefined && items.length >= total) break
    if (parsed.length === 0) break
    // 翻到页数上限还没拿完：这份列表不完整，调用方要知道自己拿到的是半份。
    if (page === MAX_PAGES) truncated = true
  }

  return { items, total, truncated }
}

async function readDependencies(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
  repository: GiteaRepository,
  index: number,
  pageSize: number,
): Promise<NativeBlockers> {
  let open = 0
  let received = 0
  let total: number | undefined
  const refs: number[] = []

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await callGiteaApi(
      deps.run,
      workspaceRoot,
      dependenciesEndpoint(repository, index, pageSize, page),
    )
    // 依赖功能被实例或仓库关闭时，Gitea 对依赖接口返回 404。
    if (response.status === 404) throw new DependenciesUnavailable()
    ensureSuccess(response, '读取 Gitea 工单依赖')

    const parsed = parseDependencies(response.body)
    open += parsed.open
    received += parsed.received
    refs.push(...parsed.refs)
    total ??= response.total

    if (total !== undefined && received >= total) break
    if (parsed.received === 0) break
  }

  return { open, refs }
}

/** 依赖功能未启用。只用于在读取阶段区分 404，不向外暴露。 */
class DependenciesUnavailable extends Error {}

/**
 * 远端版本查询：同一列表接口上只取第一条、按最近更新排序，
 * `X-Total-Count` 给出仓库总数，唯一一条给出最新更新时间。
 */
function revisionEndpoint(repository: GiteaRepository): string {
  return `/repos/${repository.owner}/${repository.name}/issues?state=all&type=issues&page=1&limit=1&sort=recentupdate`
}

/**
 * 工单列表接口。
 *
 * 增量查询只在同一条路径上加 `since`：语义是「只显示该时刻之后更新过的条目」，
 * 边界上的票由宿主向前重叠一段时间兜底。
 * 其余参数（状态、排除 PR、页码、页大小）与列表完全一致，避免增量与全量口径不同。
 */
function issuesEndpoint(
  repository: GiteaRepository,
  pageSize: number,
  page: number,
  since?: number,
): string {
  const window = since === undefined ? '' : `&since=${new Date(since).toISOString()}`
  return `/repos/${repository.owner}/${repository.name}/issues?state=all&type=issues&page=${String(page)}&limit=${String(pageSize)}${window}`
}

function dependenciesEndpoint(
  repository: GiteaRepository,
  index: number,
  pageSize: number,
  page: number,
): string {
  return `/repos/${repository.owner}/${repository.name}/issues/${String(index)}/dependencies?page=${String(page)}&limit=${String(pageSize)}`
}

function normalizePositive(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.trunc(value))
}
