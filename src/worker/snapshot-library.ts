/**
 * 本地快照库在宿主侧的那一半：读写条目、把库里的数据组装成快照、读取与清空缓存。
 *
 * 缓存按仓库归并：托管后端的条目存在仓库作用域的键上，同一仓库的多个 worktree
 * 共用一份；本地 Markdown 的条目存在工作区键上，一个 worktree 的 `.scratch/`
 * 不会串到另一个。
 *
 * 与快照服务分开是因为这里只关心「缓存里的数据」，不关心拉取流程：
 * 快照服务决定什么时候读、什么时候写，这里负责读出来的东西对不对。
 */
import type { SnapshotStore } from '../adapters/fs/snapshot-store.ts'
import { classifyTickets, type ClassifiedTicket } from '../core/classify.ts'
import { isRecord } from '../core/json.ts'
import { computeMetrics } from '../core/metrics.ts'
import type { RepositoryAddress } from '../core/remote.ts'
import { scopedKeysOf } from '../core/repository-scope.ts'
import { withSkillActions, type SkillActionDecision } from '../core/skill-action.ts'
import {
  SNAPSHOT_STORE_VERSION,
  type SnapshotStoreEntry,
  type SnapshotStoreInput,
} from '../core/snapshot-store.ts'
import type {
  BlockerResolution,
  TicketLabelNames,
  TicketReference,
  TrackerSnapshot,
} from '../core/ticket.ts'
import type { BackendKind } from '../protocol/backend.ts'
import { LOG_EVENTS, SNAPSHOT_STAGES } from '../protocol/log-events.ts'
import {
  ERROR_CODES,
  SNAPSHOT_CLEAR_CONFIRMATION,
  type ErrorCode,
  type RpcResult,
  type SnapshotCacheInfo,
  type SnapshotMetrics,
  type TicketSnapshot,
  type WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import type { ResolvedBackend } from './backend-resolver.ts'
import type { LogSink } from './log.ts'

/** 快照库相关的宿主依赖。 */
export interface SnapshotLibraryDeps {
  readonly now: () => number
  readonly labels: TicketLabelNames
  readonly log: LogSink
  /** 本地快照库；没有它时只用内存缓存。 */
  readonly store?: SnapshotStore | undefined
}

/**
 * 一份缓存。刷新会用新条目替换旧条目；
 * 补齐结果靠条目身份判断是否过期，旧条目写不回缓存。
 */
export interface CachedWorkspace {
  readonly kind: BackendKind
  /** 仓库作用域根目录；同一仓库的多个 worktree 共用一个条目。 */
  readonly scopeRoot: string
  /** 拉取这份数据的工作区根目录；本地 Markdown 按它隔离。 */
  readonly workspaceRoot: string
  /** 仓库身份：后端类型 + 实例主机 + 仓库路径；换远端或换后端时身份对不上。 */
  readonly repositoryKey: string
  /** 远端实例主机；列表与补齐两阶段共用同一份，本地 Markdown 为 null。 */
  readonly repositoryHost: string | null
  /** 后端的原始列表，补齐后按它重新判定，避免丢失标签。 */
  readonly raw: TrackerSnapshot
  snapshot: WorkspaceSnapshot
  /** 原生阻塞补齐能力；null 表示后端不实现，列表阶段已经定稿。 */
  readonly resolver: BlockerResolver | null
  /**
   * 这一代快照需要补齐的开放票引用；null 表示全部开放票。
   * 增量刷新只补变更过的开放票，刷新成本才不随开放票总数增长。
   */
  readonly blockerTargets: readonly string[] | null
  pending: Promise<RpcResult<WorkspaceSnapshot>> | null
}

/** 原生阻塞补齐能力。 */
export type BlockerResolver = (
  workspaceRoot: string,
  tickets: readonly TicketReference[],
) => Promise<BlockerResolution>

/**
 * 读取本地快照库里的条目。
 * @param deps - 宿主依赖。
 * @param key - 缓存键：仓库作用域（托管后端）或工作区根目录（本地 Markdown）。
 * @returns 条目；没有库或没有条目时是 undefined。
 */
export async function readStored(
  deps: SnapshotLibraryDeps,
  key: string,
): Promise<SnapshotStoreEntry | undefined> {
  if (deps.store === undefined) return undefined
  try {
    return await deps.store.read(key)
  } catch {
    return undefined
  }
}

/** 一次缓存命中：条目与它所在的缓存键（失效时按这个键删）。 */
export interface StoredHit {
  readonly key: string
  readonly entry: SnapshotStoreEntry
}

/**
 * 按「仓库作用域 → 工作区」的顺序找可用缓存。
 *
 * 托管后端的条目存在作用域键上，同一仓库的任一 worktree 都能读到；
 * 本地 Markdown 的条目存在工作区键上，读到别的 worktree 的条目时跳过。
 * @param deps - 宿主依赖。
 * @param scopeRoot - 仓库作用域根目录。
 * @param workspaceRoot - 当前工作区根目录。
 * @returns 命中的条目与键；没有可用缓存时是 undefined。
 */
export async function readStoredFor(
  deps: SnapshotLibraryDeps,
  scopeRoot: string,
  workspaceRoot: string,
): Promise<StoredHit | undefined> {
  const keys = scopedKeysOf(scopeRoot, workspaceRoot)
  for (const key of keys) {
    const entry = await readStored(deps, key)
    if (entry === undefined) continue
    if (!belongsToWorkspace(entry.backend, entry.workspaceRoot, workspaceRoot)) continue
    return { key, entry }
  }
  return undefined
}

/**
 * 条目是否属于这个工作区：托管后端按仓库共享，本地 Markdown 按工作区隔离。
 *
 * 判据只写这一处：读快照库与读内存缓存共用同一份规则。
 * @param backend - 条目属于哪个后端。
 * @param entryWorkspaceRoot - 条目是在哪个工作区拉到的。
 * @param workspaceRoot - 当前工作区根目录。
 * @returns 这份缓存能不能交给当前工作区。
 */
export function belongsToWorkspace(
  backend: BackendKind,
  entryWorkspaceRoot: string,
  workspaceRoot: string,
): boolean {
  return backend !== 'markdown' || entryWorkspaceRoot === workspaceRoot
}

/**
 * 删除本地快照库里的条目。
 * @param deps - 宿主依赖。
 * @param key - 缓存键。
 */
export async function removeStored(deps: SnapshotLibraryDeps, key: string): Promise<void> {
  if (deps.store === undefined) return
  try {
    await deps.store.remove(key)
  } catch {
    // 删不掉就留着：下一轮刷新会用仓库身份判定把它作废。
  }
}

/**
 * 把一次成功拉取写进本地快照库。
 * @param deps - 宿主依赖。
 * @param scopeRoot - 仓库作用域根目录。
 * @param workspaceRoot - 这次拉取所在的工作区根目录。
 * @param resolved - 解析出的后端。
 * @param raw - 后端返回的原始列表。
 * @param metrics - 与列表同源算好的概览指标。
 * @returns 新的本地库版本；没有库或写入失败时是 undefined。
 */
export async function writeStored(
  deps: SnapshotLibraryDeps,
  scopeRoot: string,
  workspaceRoot: string,
  resolved: ResolvedBackend,
  raw: TrackerSnapshot,
  metrics: SnapshotMetrics,
): Promise<number | undefined> {
  const store = deps.store
  if (store === undefined) return undefined
  const entry: SnapshotStoreInput = {
    version: SNAPSHOT_STORE_VERSION,
    scopeRoot,
    workspaceRoot,
    backend: resolved.kind,
    repository: raw.repository,
    repositoryKey: repositoryKey(resolved.kind, resolved.address),
    repositoryHost: resolved.kind === 'markdown' ? null : (resolved.address?.host ?? null),
    fetchedAt: raw.fetchedAt,
    viewer: raw.viewer,
    total: raw.total,
    ...(raw.nextCursor === undefined ? {} : { nextCursor: raw.nextCursor }),
    tickets: raw.tickets,
    hierarchy: raw.hierarchy,
    revision: raw.revision,
    metrics,
  }
  try {
    return await store.write(entry)
  } catch (error) {
    // 缓存写不进去不影响本次读取：面板照常有数据，只是下次没有缓存可用。
    deps.log('warn', LOG_EVENTS.snapshot, {
      result: 'error',
      backend: resolved.kind,
      stage: SNAPSHOT_STAGES.list,
      code: ERROR_CODES.internal,
      ...(error instanceof Error ? { reason: error.message } : {}),
    })
    return undefined
  }
}

/**
 * 用库里的数据组装一份快照。
 * @param deps - 宿主依赖。
 * @param stored - 库里的条目。
 * @param state - 陈旧标记与失败原因。
 * @returns 快照。
 */
export function buildStoredSnapshot(
  deps: SnapshotLibraryDeps,
  stored: SnapshotStoreEntry,
  state: {
    readonly stale: boolean
    readonly refreshError: { readonly code: ErrorCode; readonly message: string } | null
  },
): WorkspaceSnapshot {
  const raw = rawOf(stored)
  const tickets = withSkillActions(classifyTickets(raw.tickets, deps.labels), deps.labels)
  // 写入时已从同一份票数据算好指标；只有写操作清空过它时才重算。
  const metrics = stored.metrics ?? metricsOf(deps, stored.backend, raw, tickets, false)
  return {
    backend: stored.backend,
    repository: raw.repository,
    repositoryHost: stored.repositoryHost,
    fetchedAt: raw.fetchedAt,
    viewer: raw.viewer,
    loaded: tickets.length,
    total: raw.total,
    hasMore: raw.nextCursor !== undefined,
    hierarchy: stored.hierarchy,
    blockersFinalized: false,
    metrics,
    source: 'cache',
    stale: state.stale,
    refreshError: state.refreshError,
    revision: stored.revision?.id ?? null,
    storeRevision: stored.storeRevision,
    tickets: ticketSnapshotsOf(tickets),
  }
}

/**
 * 把判定后的票映射成界面快照行。
 * 整份快照与增量回包共用这一份，字段不会在两条路径上分叉。
 * @param tickets - 已判定技能动作的票。
 * @returns 快照行。
 */
export function ticketSnapshotsOf(
  tickets: readonly (ClassifiedTicket & SkillActionDecision)[],
): readonly TicketSnapshot[] {
  return tickets.map((ticket) => ({
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
    ...(ticket.parent === undefined ? {} : { parent: ticket.parent }),
    ...(ticket.url === undefined ? {} : { url: ticket.url }),
  }))
}

/**
 * 用库里的数据组装缓存条目。
 * @param stored - 库里的条目。
 * @param resolved - 解析出的后端；解析失败时为 null。
 * @param snapshot - 组装好的快照。
 * @returns 缓存条目。
 */
export function storedEntry(
  stored: SnapshotStoreEntry,
  resolved: ResolvedBackend | null,
  snapshot: WorkspaceSnapshot,
): CachedWorkspace {
  return {
    kind: stored.backend,
    scopeRoot: stored.scopeRoot,
    workspaceRoot: stored.workspaceRoot,
    repositoryKey: stored.repositoryKey,
    repositoryHost: stored.repositoryHost,
    raw: rawOf(stored),
    snapshot,
    resolver: resolved?.tracker.resolveBlockers ?? null,
    // 从库里恢复时不知道上次增量只补了哪些票：按全部开放票补齐。
    blockerTargets: null,
    pending: null,
  }
}

/**
 * 读取或清空本地快照库。
 * @param deps - 宿主依赖。
 * @param cache - 内存缓存；清空时一起丢掉。
 * @param params - 请求参数。
 * @returns 本地快照库的信息。
 */
export async function cacheInfo(
  deps: SnapshotLibraryDeps,
  cache: Map<string, CachedWorkspace>,
  params: unknown,
): Promise<RpcResult<SnapshotCacheInfo>> {
  const store = deps.store
  if (store === undefined) {
    return {
      ok: true,
      result: { location: '未启用本地快照库', entries: 0, lastWrittenAt: null, cleared: 0 },
    }
  }

  if (!isClearRequest(params)) {
    const entries = await store.list()
    return {
      ok: true,
      result: {
        location: store.location(),
        entries: entries.length,
        lastWrittenAt: latestWrite(entries),
        cleared: 0,
      },
    }
  }

  if (readConfirm(params) !== SNAPSHOT_CLEAR_CONFIRMATION) {
    return {
      ok: false,
      error: { code: ERROR_CODES.invalidParams, message: '清空本地快照库需要确认词。' },
    }
  }

  const cleared = await store.clear()
  // 内存里还留着旧快照：一起丢掉，下一次读取重新实时拉取。
  cache.clear()
  return {
    ok: true,
    result: { location: store.location(), entries: 0, lastWrittenAt: null, cleared },
  }
}

/**
 * 组装快照时计算指标。时钟取后端的快照时间，让指标与界面显示的“多久之前”一致。
 * 本地 Markdown 的时间是文件创建/修改时间，不是工单时间，时效与流量指标按不可用处理。
 */
export function metricsOf(
  deps: SnapshotLibraryDeps,
  kind: BackendKind,
  raw: TrackerSnapshot,
  tickets: readonly ClassifiedTicket[],
  blockersFinalized: boolean,
): SnapshotMetrics {
  return computeMetrics({
    tickets,
    total: raw.total,
    now: raw.fetchedAt,
    timestamps: kind !== 'markdown',
    blockersFinalized,
    labels: deps.labels,
  })
}

/**
 * 仓库身份：后端类型 + 实例主机 + 仓库路径。
 * 换远端或换后端时身份对不上，缓存作废。
 */
export function repositoryKey(kind: BackendKind, address: RepositoryAddress | undefined): string {
  if (address === undefined) return kind
  return `${kind}@${address.host}/${address.path}`
}

/** 把库里的条目还原成后端快照的形状。 */
function rawOf(stored: SnapshotStoreEntry): TrackerSnapshot {
  return {
    repository: stored.repository,
    fetchedAt: stored.fetchedAt,
    loaded: stored.tickets.length,
    total: stored.total,
    tickets: stored.tickets,
    viewer: stored.viewer,
    hierarchy: stored.hierarchy,
    revision: stored.revision,
    ...(stored.nextCursor === undefined ? {} : { nextCursor: stored.nextCursor }),
  }
}

/** 读出「清空」标记。 */
function isClearRequest(params: unknown): boolean {
  return isRecord(params) && params.clear === true
}

/** 读出确认词。 */
function readConfirm(params: unknown): string | undefined {
  if (!isRecord(params)) return undefined
  return typeof params.confirm === 'string' ? params.confirm : undefined
}

/** 最近一次写入时间；没有条目时是 null。 */
function latestWrite(entries: readonly SnapshotStoreEntry[]): number | null {
  let latest: number | null = null
  for (const entry of entries) {
    if (latest === null || entry.fetchedAt > latest) latest = entry.fetchedAt
  }
  return latest
}
