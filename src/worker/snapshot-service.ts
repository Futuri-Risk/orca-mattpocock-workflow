/**
 * 快照服务：本地快照库、增量刷新、阻塞补齐与错误映射。主接缝是 `handle(method, params)`，
 * 测试注入假的「按工作区解析后端」函数、假的「解析仓库作用域」函数与假的快照库
 * 就能覆盖缓存、增量、错误码和刷新失败保留旧快照。
 *
 * 读取分两个阶段：
 * 1. 列表：后端返回列表即生成快照；GitHub 的原生阻塞数在同一次查询里取回，
 *    其余后端的阻塞数先按描述回退；
 * 2. 补齐：仅当后端实现 `resolveBlockers` 时读取原生阻塞数，合并后写回缓存。
 * 补齐按仓库去重；刷新替换缓存条目，旧的补齐结果不会覆盖新快照。
 *
 * 缓存身份是仓库作用域（该仓库的主 worktree 根目录），不是工作区根目录：
 * 同一个仓库的多个 worktree 共用一份内存快照与一份库文件，拉取时刻、增量窗口
 * 与写操作因此全都对得上。命令仍然在工作区里跑，`workspaceRoot` 照旧传给后端。
 * 本地 Markdown 后端是例外：它的「仓库」就是当前工作区的 `.scratch/`，
 * 缓存键退回工作区，一个 worktree 的本地工单不会串到另一个。
 *
 * 本地快照库是跨进程的缓存：每个仓库一个文件，存最近一次成功拉取的原始工单。
 * 打开面板先读库（不发远端请求），客户端随即发起一次刷新把库推向最新：
 * 有可用库且后端支持增量时走增量，否则全量重拉。刷新失败保留旧数据，
 * 并把失败原因放进快照，界面据此说明「显示的是本地缓存」。
 */
import { mergeNativeBlockers } from '../core/blockers.ts'
import { classifyTickets, type ClassifiedTicket } from '../core/classify.ts'
import { isRecord } from '../core/json.ts'
import { mergeTickets } from '../core/merge.ts'
import { scopedKeysOf, storeKeyOf } from '../core/repository-scope.ts'
import { withSkillActions, type SkillActionDecision } from '../core/skill-action.ts'
import type { TicketReference, TrackerChanges, TrackerSnapshot } from '../core/ticket.ts'
import { TrackerError } from '../core/tracker-error.ts'
import type { BackendKind } from '../protocol/backend.ts'
import { LOG_EVENTS, SNAPSHOT_STAGES } from '../protocol/log-events.ts'
import {
  ERROR_CODES,
  RPC_METHODS,
  type ErrorCode,
  type RpcResult,
  type SnapshotCacheInfo,
  type SnapshotMetrics,
  type SnapshotSource,
  type WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import type { BackendResolver, ResolvedBackend } from './backend-resolver.ts'
import type { RepositoryScopeResolver } from './repository-scope.ts'
import { readWorkspaceRoot } from './rpc-params.ts'
import {
  belongsToWorkspace,
  buildStoredSnapshot,
  cacheInfo,
  metricsOf,
  readStoredFor,
  removeStored,
  repositoryKey,
  storedEntry,
  writeStored,
  type BlockerResolver,
  type CachedWorkspace,
  type SnapshotLibraryDeps,
  type StoredHit,
} from './snapshot-library.ts'

/**
 * 增量窗口向前重叠的时长。远端时钟偏移与最终一致性都可能让边界上的票漏掉，
 * 多取一点再按工单引用去重，比漏票安全。
 */
const INCREMENTAL_OVERLAP_MS = 60_000

/** 快照服务依赖。 */
export interface SnapshotServiceDeps extends SnapshotLibraryDeps {
  /** 按工作区解析后端；解析结果由宿主自己缓存。 */
  readonly resolve: BackendResolver
  /**
   * 按工作区解析所属仓库的作用域根目录；解析失败时退回工作区根目录。
   * 作用域只决定缓存身份，后端命令仍在工作区里跑。
   */
  readonly scope: RepositoryScopeResolver
}

/** 宿主对界面的唯一 RPC 入口。 */
export interface SnapshotService {
  /**
   * 处理一个快照方法。
   * @param method - 快照读取、刷新、追加或阻塞补齐方法之一。
   * @param params - 方法参数。
   * @returns 成功快照或带错误码的失败。
   */
  handle(method: string, params: unknown): Promise<RpcResult<WorkspaceSnapshot>>
  /**
   * 读取或清空本地快照库。
   * @param params - 请求参数；带确认词时可以清空。
   * @returns 本地快照库的信息。
   */
  cache(params: unknown): Promise<RpcResult<SnapshotCacheInfo>>
}

/**
 * 创建按仓库作用域缓存的快照服务。
 * @param deps - 工单后端、作用域解析、时钟、标签名、日志出口与可选的本地快照库。
 * @returns 快照服务。
 */
export function createSnapshotService(deps: SnapshotServiceDeps): SnapshotService {
  const cache = new Map<string, CachedWorkspace>()
  // 冷启动时两个面板会同时请求：共享同一次列表拉取，后续补齐才能挂到同一条缓存上。
  const loading = new Map<string, Promise<RpcResult<WorkspaceSnapshot>>>()
  // 「加载更多」按工作区去重：连点两次只发一次请求，第二次拿到同一份结果。
  const paging = new Map<string, Promise<RpcResult<WorkspaceSnapshot>>>()

  return {
    async handle(method, params) {
      if (!isSnapshotMethod(method)) {
        return failure(ERROR_CODES.unknownMethod, `未知方法：${method}`)
      }

      const workspaceRoot = readWorkspaceRoot(params)
      if (workspaceRoot === undefined) {
        return failure(ERROR_CODES.invalidParams, '缺少非空的 workspaceRoot 参数。')
      }
      const target: Target = { scopeRoot: await scopeOf(deps, workspaceRoot), workspaceRoot }

      if (method === RPC_METHODS.snapshotGet) {
        return getSnapshot(deps, cache, loading, target)
      }

      if (method === RPC_METHODS.snapshotResolveBlockers) {
        return resolveBlockers(deps, cache, loading, target)
      }

      if (method === RPC_METHODS.snapshotLoadMore) {
        return loadMore(deps, cache, loading, paging, target)
      }

      return refreshSnapshot(deps, cache, target, readFullFlag(params))
    },

    cache(params) {
      if (readWorkspaceRoot(params) === undefined) {
        return Promise.resolve({
          ok: false,
          error: { code: ERROR_CODES.invalidParams, message: '缺少非空的 workspaceRoot 参数。' },
        })
      }
      return cacheInfo(deps, cache, params)
    },
  }
}

function isSnapshotMethod(method: string): boolean {
  return (
    method === RPC_METHODS.snapshotGet ||
    method === RPC_METHODS.snapshotRefresh ||
    method === RPC_METHODS.snapshotLoadMore ||
    method === RPC_METHODS.snapshotResolveBlockers
  )
}

/** 读出「全量刷新」标记。 */
function readFullFlag(params: unknown): boolean {
  return isRecord(params) && params.full === true
}

/**
 * 一次请求的定位。
 *
 * 缓存身份是 `scopeRoot`（同一仓库的多个 worktree 共用一个）。
 * 命令位置是 `workspaceRoot`：git / gh / glab / tea 与本地 `.scratch/` 都在它下面。
 */
interface Target {
  readonly scopeRoot: string
  readonly workspaceRoot: string
}

/** 解析仓库作用域；解析器自身失败时按工作区自己处理，不把面板请求拖崩。 */
async function scopeOf(deps: SnapshotServiceDeps, workspaceRoot: string): Promise<string> {
  try {
    return await deps.scope(workspaceRoot)
  } catch {
    return workspaceRoot
  }
}

/** 内存缓存的键：与本地快照库同一套规则。 */
function memoryKeyOf(target: Target, kind: BackendKind): string {
  return storeKeyOf(kind, target.scopeRoot, target.workspaceRoot)
}

/**
 * 取当前工作区可用的内存缓存。
 *
 * 托管后端读仓库作用域那一份；本地 Markdown 读工作区自己那一份，
 * 别的 worktree 的本地工单不会露出来。
 * @param cache - 内存缓存。
 * @param target - 本次请求的定位。
 * @returns 可用的缓存条目；没有命中时是 undefined。
 */
function cachedWorkspace(
  cache: Map<string, CachedWorkspace>,
  target: Target,
): CachedWorkspace | undefined {
  for (const key of scopedKeysOf(target.scopeRoot, target.workspaceRoot)) {
    const entry = cache.get(key)
    if (entry === undefined) continue
    if (!belongsToWorkspace(entry.kind, entry.workspaceRoot, target.workspaceRoot)) continue
    return entry
  }
  return undefined
}

/**
 * 读取快照：先给内存缓存，再给本地快照库，最后才实时拉取。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param loading - 进行中的首屏拉取。
 * @param target - 本次请求的定位。
 * @returns 快照或失败。
 */
function getSnapshot(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  loading: Map<string, Promise<RpcResult<WorkspaceSnapshot>>>,
  target: Target,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const cached = cachedWorkspace(cache, target)
  if (cached !== undefined) return Promise.resolve({ ok: true, result: cached.snapshot })

  return loadWorkspace(deps, cache, loading, target)
}

/**
 * 首屏拉取：同一仓库的并发请求共享同一次拉取。
 *
 * 去重键是仓库作用域：同一仓库的多个 worktree 同时首屏只发一次列表查询。
 * 本地 Markdown 的缓存按工作区隔离，共享到的如果是别的 worktree 的本地工单，
 * 这个 worktree 自己再读一次，绝不把别人的 `.scratch/` 显示出来。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param loading - 进行中的首屏拉取。
 * @param target - 本次请求的定位。
 * @returns 快照或失败。
 */
function loadWorkspace(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  loading: Map<string, Promise<RpcResult<WorkspaceSnapshot>>>,
  target: Target,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const shared = singleFlight(loading, target.scopeRoot, () => readWorkspace(deps, cache, target))
  return shared.then(async (result) => {
    const cached = cachedWorkspace(cache, target)
    if (cached !== undefined) return { ok: true, result: cached.snapshot }
    if (result.ok && result.result.backend === 'markdown') {
      return await readWorkspace(deps, cache, target)
    }
    return result
  })
}

/**
 * 同一个键的并发请求共享一次执行；成功或失败后释放槽位。
 * @param flights - 进行中的请求表。
 * @param key - 去重键。
 * @param start - 真正发起请求的函数。
 * @returns 这次（或正在进行的）请求结果。
 */
function singleFlight(
  flights: Map<string, Promise<RpcResult<WorkspaceSnapshot>>>,
  key: string,
  start: () => Promise<RpcResult<WorkspaceSnapshot>>,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const running = flights.get(key)
  if (running !== undefined) return running

  const task = start()
  flights.set(key, task)
  void task.then(
    () => {
      flights.delete(key)
    },
    () => {
      flights.delete(key)
    },
  )
  return task
}

/**
 * 首屏：库里有料就先给库里那份，再由客户端发起刷新把它推向最新。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param target - 本次请求的定位。
 * @returns 快照或失败。
 */
async function readWorkspace(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  target: Target,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const hit = await readStoredFor(deps, target.scopeRoot, target.workspaceRoot)
  if (hit !== undefined) {
    const served = await serveStored(deps, cache, target, hit)
    if (served !== undefined) return served
  }
  return fetchAndCache(deps, cache, target)
}

/**
 * 把本地快照库里的数据交给界面。
 *
 * 先确认这份缓存属于当前仓库：换远端、换后端时身份对不上，缓存作废并按全量重拉。
 * 后端暂时解析不出来时仍然显示缓存，但标成陈旧并带上失败原因。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param target - 本次请求的定位。
 * @param hit - 库里的条目与它所在的键。
 * @returns 快照；缓存不属于当前仓库时返回 undefined，交给调用方实时拉取。
 */
async function serveStored(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  target: Target,
  hit: StoredHit,
): Promise<RpcResult<WorkspaceSnapshot> | undefined> {
  const stored = hit.entry
  let resolved: ResolvedBackend
  try {
    resolved = await deps.resolve(target.workspaceRoot)
  } catch (error) {
    const mapped = mapError(error)
    const snapshot = buildStoredSnapshot(deps, stored, {
      stale: true,
      refreshError: { code: mapped.code, message: mapped.message },
    })
    cache.set(hit.key, storedEntry(stored, null, snapshot))
    return { ok: true, result: snapshot }
  }

  if (repositoryKey(resolved.kind, resolved.address) !== stored.repositoryKey) {
    // 身份换了：旧条目可能还躺在别的键上，按读到它的键删掉。
    await removeStored(deps, hit.key)
    return undefined
  }

  const snapshot = buildStoredSnapshot(deps, stored, { stale: true, refreshError: null })
  cache.set(hit.key, storedEntry(stored, resolved, snapshot))
  return { ok: true, result: snapshot }
}

/**
 * 刷新：能用增量就增量，否则全量重拉。
 *
 * 增量以本地快照库里的数据为基准，窗口起点是上次成功拉取的时刻向前重叠一小段。
 * 同一仓库的多个 worktree 共用这条链：换 worktree 不会把边界上的票丢掉。
 * 增量被后端截断时退回全量，不把一份不完整的结果当成完整结果。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param target - 本次请求的定位。
 * @param full - 为 true 时忽略本地快照库，全量重拉。
 * @returns 快照或失败。
 */
async function refreshSnapshot(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  target: Target,
  full: boolean,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const startedAt = deps.now()

  let resolved: ResolvedBackend
  try {
    resolved = await deps.resolve(target.workspaceRoot)
  } catch (error) {
    return await keepOldSnapshot(deps, cache, target, mapError(error), startedAt)
  }

  const hit = await readStoredFor(deps, target.scopeRoot, target.workspaceRoot)
  const base =
    hit?.entry.repositoryKey === repositoryKey(resolved.kind, resolved.address)
      ? hit.entry
      : undefined
  const tracker = resolved.tracker
  // 只覆盖了一部分却没有游标的条目来自旧版本：增量合并补不出下一页，必须全量重拉一页。
  const extendable =
    base === undefined || base.nextCursor !== undefined || base.total <= base.tickets.length

  if (base !== undefined && !full && extendable && tracker.fetchChanges !== undefined) {
    const merged = await mergeIncremental(deps, cache, target, resolved, base, startedAt)
    if (merged !== undefined) return merged
  }

  try {
    const raw = await tracker.fetchSnapshot(target.workspaceRoot)
    return await publish(
      deps,
      cache,
      target,
      resolved,
      withViewerFallback(raw, base?.viewer),
      startedAt,
      'full',
    )
  } catch (error) {
    return await keepOldSnapshot(deps, cache, target, mapError(error), startedAt)
  }
}

/**
 * 走一次增量拉取并合并。
 *
 * 增量被后端截断时返回 undefined，交给调用方退回全量重拉；
 * 增量请求失败时保留旧数据并带上失败原因。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param target - 本次请求的定位。
 * @param resolved - 解析出的后端。
 * @param base - 库里的基准数据。
 * @param startedAt - 这次刷新的起始时刻。
 * @returns 合并后的快照；退回全量时是 undefined。
 */
async function mergeIncremental(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  target: Target,
  resolved: ResolvedBackend,
  base: StoredHit['entry'],
  startedAt: number,
): Promise<RpcResult<WorkspaceSnapshot> | undefined> {
  const tracker = resolved.tracker
  if (tracker.fetchChanges === undefined) return undefined

  let changes: TrackerChanges
  try {
    changes = await tracker.fetchChanges(
      target.workspaceRoot,
      base.fetchedAt - INCREMENTAL_OVERLAP_MS,
    )
  } catch (error) {
    return await keepOldSnapshot(deps, cache, target, mapError(error), startedAt)
  }

  if (changes.truncated) {
    // 增量被截断：这份结果不完整，退回全量重拉。
    deps.log('warn', LOG_EVENTS.snapshot, {
      result: 'error',
      backend: resolved.kind,
      stage: SNAPSHOT_STAGES.list,
      code: ERROR_CODES.fetchFailed,
      durationMs: Math.max(0, deps.now() - startedAt),
    })
    return undefined
  }

  // 不按窗口上限裁剪：增量里可能有窗口外的票被更新，它们现在属于最前面；
  // 裁掉尾部会留下一个游标已经越过的空洞，而那些票再也取不回来。
  const merged = mergeTickets(base.tickets, changes.tickets)
  const nextCursor = base.nextCursor
  const raw: TrackerSnapshot = {
    repository: base.repository,
    fetchedAt: deps.now(),
    loaded: merged.length,
    total: changes.total ?? base.total,
    tickets: merged,
    // 增量没查身份时沿用基准数据里的；查了但没识别出来则按 null 记。
    viewer: changes.viewer === undefined ? base.viewer : changes.viewer,
    // 游标仍指向已加载窗口之后的第一张；窗口大小由已加载数表达。
    ...(nextCursor === undefined ? {} : { nextCursor }),
  }
  return await publish(deps, cache, target, resolved, raw, startedAt, 'incremental')
}

/**
 * 按游标取下一段并追加到已加载的列表。
 *
 * 同一工作区的并发请求共享一次拉取：连点「加载更多」不会重复消耗配额。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param loading - 进行中的首屏拉取。
 * @param paging - 进行中的「加载更多」。
 * @param target - 本次请求的定位。
 * @returns 追加后的快照或失败。
 */
function loadMore(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  loading: Map<string, Promise<RpcResult<WorkspaceSnapshot>>>,
  paging: Map<string, Promise<RpcResult<WorkspaceSnapshot>>>,
  target: Target,
): Promise<RpcResult<WorkspaceSnapshot>> {
  return singleFlight(paging, target.workspaceRoot, () =>
    appendPage(deps, cache, loading, target),
  )
}

/**
 * 取下一页并合并进当前快照。
 *
 * - 快照没有游标时原样返回：后端一次取全，或列表已经覆盖全部；
 * - 新的一段按工单引用去重后并入旧列表，窗口上限跟着已加载数走，
 *   增量合并仍与同样范围的重新拉取一致；
 * - 拉取失败保留已有列表，把原因记在快照上，用户可以再点一次；
 * - 拉取期间刷新替换了缓存时丢弃这一页，不把旧游标的结果写回新快照。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param loading - 进行中的首屏拉取。
 * @param target - 本次请求的定位。
 * @returns 追加后的快照或失败。
 */
async function appendPage(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  loading: Map<string, Promise<RpcResult<WorkspaceSnapshot>>>,
  target: Target,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const startedAt = deps.now()

  let entry = cachedWorkspace(cache, target)
  if (entry === undefined) {
    const loaded = await loadWorkspace(deps, cache, loading, target)
    if (!loaded.ok) return loaded
    entry = cachedWorkspace(cache, target)
    if (entry === undefined) return loaded
  }

  const cursor = entry.raw.nextCursor
  if (cursor === undefined) return { ok: true, result: entry.snapshot }

  let resolved: ResolvedBackend
  try {
    resolved = await deps.resolve(target.workspaceRoot)
  } catch (error) {
    return await keepOldSnapshot(deps, cache, target, mapError(error), startedAt)
  }

  // 仓库换了：旧游标属于另一个仓库，按刷新流程重建快照，不把两个仓库的票混在一起。
  if (repositoryKey(resolved.kind, resolved.address) !== entry.repositoryKey) {
    return await refreshSnapshot(deps, cache, target, false)
  }

  let page: TrackerSnapshot
  try {
    page = await resolved.tracker.fetchSnapshot(target.workspaceRoot, { cursor })
  } catch (error) {
    return await keepOldSnapshot(deps, cache, target, mapError(error), startedAt)
  }

  const key = storeKeyOf(entry.kind, entry.scopeRoot, entry.workspaceRoot)
  if (cache.get(key) !== entry) {
    const current = cache.get(key)
    if (current === undefined) {
      return failure(ERROR_CODES.internal, '加载更多时缓存被清空，请重新读取工单。')
    }
    return { ok: true, result: current.snapshot }
  }

  const merged = mergeTickets(entry.raw.tickets, page.tickets)
  // 游标没往前走说明后端没有真的翻页，停在这里，不让用户无限点下去。
  const nextCursor = page.nextCursor === cursor ? undefined : page.nextCursor
  const raw: TrackerSnapshot = {
    repository: entry.raw.repository,
    fetchedAt: deps.now(),
    loaded: merged.length,
    total: page.total,
    tickets: merged,
    // 扩窗响应没带身份时沿用当前已知身份，不因为翻页把筛选行清掉。
    viewer: withViewerFallback(page, entry.raw.viewer).viewer,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  }
  return await publish(deps, cache, target, resolved, raw, startedAt, 'more')
}

/**
 * 全量或扩窗响应没有识别出身份时，沿用同一仓库上一次已知的身份。
 * 一次身份查询抖动不该让人员筛选整行消失；没有已知身份时保持 null。
 * @param raw - 本次拉取的列表。
 * @param previous - 上一次已知的当前用户；没有时为 null / undefined。
 * @returns 带身份回退的列表。
 */
function withViewerFallback(
  raw: TrackerSnapshot,
  previous: string | null | undefined,
): TrackerSnapshot {
  if (raw.viewer !== null || previous === null || previous === undefined) return raw
  return { ...raw, viewer: previous }
}

/**
 * 全量拉取并写缓存。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param target - 本次请求的定位。
 * @returns 快照或失败。
 */
async function fetchAndCache(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  target: Target,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const startedAt = deps.now()
  let kind: BackendKind | undefined

  try {
    const resolved = await deps.resolve(target.workspaceRoot)
    kind = resolved.kind
    const raw = await resolved.tracker.fetchSnapshot(target.workspaceRoot)
    return await publish(deps, cache, target, resolved, raw, startedAt, 'full')
  } catch (error) {
    const mapped = mapError(error)
    deps.log('warn', LOG_EVENTS.snapshot, {
      result: 'error',
      ...(kind === undefined ? {} : { backend: kind }),
      stage: SNAPSHOT_STAGES.list,
      code: mapped.code,
      durationMs: Math.max(0, deps.now() - startedAt),
    })
    return failure(mapped.code, mapped.message)
  }
}

/**
 * 发布一次成功拉取的结果：写内存缓存、写本地快照库、返回快照。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param target - 本次请求的定位。
 * @param resolved - 解析出的后端。
 * @param raw - 后端返回的原始列表。
 * @param startedAt - 这次拉取的起始时刻。
 * @param mode - 这次是全量、增量还是追加一页。
 * @returns 快照。
 */
async function publish(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  target: Target,
  resolved: ResolvedBackend,
  raw: TrackerSnapshot,
  startedAt: number,
  mode: 'full' | 'incremental' | 'more',
): Promise<RpcResult<WorkspaceSnapshot>> {
  const tickets = withSkillActions(classifyTickets(raw.tickets, deps.labels), deps.labels)
  const resolver = resolved.tracker.resolveBlockers ?? null
  const repositoryHost = resolved.kind === 'markdown' ? null : (resolved.address?.host ?? null)
  const finalized = resolver === null || !tickets.some((ticket) => ticket.state === 'open')
  const metrics = metricsOf(deps, resolved.kind, raw, tickets, finalized)
  const snapshot = buildSnapshot(
    resolved.kind,
    repositoryHost,
    raw,
    tickets,
    finalized,
    metrics,
    'live',
    false,
    null,
  )

  cache.set(memoryKeyOf(target, resolved.kind), {
    kind: resolved.kind,
    scopeRoot: target.scopeRoot,
    workspaceRoot: target.workspaceRoot,
    repositoryKey: repositoryKey(resolved.kind, resolved.address),
    repositoryHost,
    raw,
    snapshot,
    resolver,
    pending: null,
  })

  await writeStored(deps, target.scopeRoot, target.workspaceRoot, resolved, raw)

  deps.log('info', LOG_EVENTS.snapshot, {
    result: 'ok',
    backend: resolved.kind,
    stage: SNAPSHOT_STAGES.list,
    durationMs: Math.max(0, deps.now() - startedAt),
    repository: snapshot.repository,
    loaded: snapshot.loaded,
    total: snapshot.total,
    mode,
  })
  return { ok: true, result: snapshot }
}

/**
 * 刷新失败时保留旧数据：把失败原因放进快照，界面据此说明「显示的是本地缓存」。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param target - 本次请求的定位。
 * @param mapped - 映射后的错误码与文案。
 * @param startedAt - 这次刷新的起始时刻。
 * @returns 有旧数据时返回带失败原因的快照，否则返回失败。
 */
async function keepOldSnapshot(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  target: Target,
  mapped: { readonly code: ErrorCode; readonly message: string },
  startedAt: number,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const refreshError = { code: mapped.code, message: mapped.message }
  const cached = cachedWorkspace(cache, target)
  if (cached !== undefined) {
    const snapshot: WorkspaceSnapshot = { ...cached.snapshot, stale: true, refreshError }
    cached.snapshot = snapshot
    deps.log('warn', LOG_EVENTS.snapshot, {
      result: 'error',
      backend: cached.kind,
      stage: SNAPSHOT_STAGES.list,
      code: mapped.code,
      durationMs: Math.max(0, deps.now() - startedAt),
    })
    return { ok: true, result: snapshot }
  }

  // 内存里还没有快照，但库里可能有：把库里的数据显示出来并说明刷新失败。
  const hit = await readStoredFor(deps, target.scopeRoot, target.workspaceRoot)
  if (hit === undefined) return failure(mapped.code, mapped.message)

  const snapshot = buildStoredSnapshot(deps, hit.entry, { stale: true, refreshError })
  cache.set(hit.key, storedEntry(hit.entry, null, snapshot))
  deps.log('warn', LOG_EVENTS.snapshot, {
    result: 'error',
    backend: hit.entry.backend,
    stage: SNAPSHOT_STAGES.list,
    code: mapped.code,
    durationMs: Math.max(0, deps.now() - startedAt),
  })
  return { ok: true, result: snapshot }
}

/**
 * 补齐入口：没有缓存时先按 `snapshot.get` 的规则拉一次列表。
 * 命中缓存时同步登记进行中的补齐，保证并发调用共享同一个请求。
 */
function resolveBlockers(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  loading: Map<string, Promise<RpcResult<WorkspaceSnapshot>>>,
  target: Target,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const cached = cachedWorkspace(cache, target)
  if (cached !== undefined) return resolveCached(deps, cache, target, cached)

  return loadWorkspace(deps, cache, loading, target).then((result) => {
    if (!result.ok) return result
    const entry = cachedWorkspace(cache, target)
    return entry === undefined ? result : resolveCached(deps, cache, target, entry)
  })
}

function resolveCached(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  target: Target,
  entry: CachedWorkspace,
): Promise<RpcResult<WorkspaceSnapshot>> {
  if (entry.snapshot.blockersFinalized || entry.resolver === null) {
    return Promise.resolve({ ok: true, result: entry.snapshot })
  }

  if (entry.pending !== null) return entry.pending

  const task = finalize(deps, cache, target, entry, entry.resolver)
  entry.pending = task
  return task
}

async function finalize(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  target: Target,
  entry: CachedWorkspace,
  resolver: BlockerResolver,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const startedAt = deps.now()
  const targets: TicketReference[] = entry.snapshot.tickets
    .filter((ticket) => ticket.state === 'open')
    .map((ticket) => ({ ref: ticket.ref, number: ticket.number }))

  let settled: WorkspaceSnapshot
  let failure: { readonly code: ErrorCode; readonly message: string } | null = null

  try {
    const native = await resolver(target.workspaceRoot, targets)
    const tickets = withSkillActions(
      classifyTickets(mergeNativeBlockers(entry.raw.tickets, native), deps.labels),
      deps.labels,
    )
    const metrics = metricsOf(deps, entry.kind, entry.raw, tickets, true)
    settled = buildSnapshot(
      entry.kind,
      entry.repositoryHost,
      entry.raw,
      tickets,
      true,
      metrics,
      entry.snapshot.source,
      entry.snapshot.stale,
      entry.snapshot.refreshError,
    )
  } catch (error) {
    // 补齐失败只影响定稿标记：保留阶段一结果，下一次刷新重新尝试。
    failure = mapError(error)
    settled = { ...entry.snapshot, blockersFinalized: true }
  }

  // 刷新会用新条目替换缓存；旧条目的结果不能再写回去。
  const key = storeKeyOf(entry.kind, entry.scopeRoot, entry.workspaceRoot)
  const stale = cache.get(key) !== entry
  if (!stale) {
    entry.snapshot = settled
    entry.pending = null
  }

  deps.log(failure === null ? 'info' : 'warn', LOG_EVENTS.snapshot, {
    result: failure === null ? 'ok' : 'error',
    backend: entry.kind,
    stage: SNAPSHOT_STAGES.blockers,
    ...(failure === null ? {} : { code: failure.code }),
    durationMs: Math.max(0, deps.now() - startedAt),
    ...(stale ? { stale: true } : {}),
  })
  // 旧调用方拿到的是它那一代快照的定稿结果；缓存里已经是新快照，不受影响。
  return { ok: true, result: settled }
}

function buildSnapshot(
  kind: BackendKind,
  repositoryHost: string | null,
  raw: TrackerSnapshot,
  tickets: readonly (ClassifiedTicket & SkillActionDecision)[],
  blockersFinalized: boolean,
  metrics: SnapshotMetrics,
  source: SnapshotSource,
  stale: boolean,
  refreshError: { readonly code: ErrorCode; readonly message: string } | null,
): WorkspaceSnapshot {
  return {
    backend: kind,
    repository: raw.repository,
    repositoryHost,
    fetchedAt: raw.fetchedAt,
    viewer: raw.viewer,
    loaded: tickets.length,
    total: raw.total,
    hasMore: raw.nextCursor !== undefined,
    blockersFinalized,
    metrics,
    source,
    stale,
    refreshError,
    tickets: tickets.map((ticket) => ({
      ref: ticket.ref,
      number: ticket.number,
      title: ticket.title,
      state: ticket.state,
      category: ticket.category,
      status: ticket.status,
      labels: ticket.labels,
      author: ticket.author,
      assignees: ticket.assignees,
      skillAction: ticket.skillAction,
      skillActionReason: ticket.skillActionReason,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      openBlockers: ticket.openBlockers,
      ...(ticket.closedAt === undefined ? {} : { closedAt: ticket.closedAt }),
      ...(ticket.blockedBy === undefined ? {} : { blockedBy: ticket.blockedBy }),
    })),
  }
}

function mapError(error: unknown): { readonly code: ErrorCode; readonly message: string } {
  if (error instanceof TrackerError) {
    return { code: error.code, message: error.message }
  }
  return { code: ERROR_CODES.internal, message: '读取工单时发生未预期的错误。' }
}

function failure(code: ErrorCode, message: string): RpcResult<WorkspaceSnapshot> {
  return { ok: false, error: { code, message } }
}
