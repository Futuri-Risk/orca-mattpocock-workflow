/**
 * 本地快照库的条目模型：目录里的 meta、每票文件与变化集该长什么样。
 *
 * 一个缓存键一个目录：meta 是提交点，票文件只存后端原始数据，变化集从追加日志派生。
 * meta 里的 `storeRevision` 是单调递增的提交序号；`revision` 是远端的版本号，
 * 两者回答不同的问题（本地库里有什么 / 远端变了吗），不能混用。
 *
 * 纯逻辑：core 不做 IO。目录读写在 adapters/fs，内容能不能用在这里判定——
 * 格式版本不符或单个文件损坏时按「没有缓存」处理，不让一次坏文件卡住面板，
 * 也不影响其它工作区的缓存。
 */
import type { BackendKind } from '../protocol/backend.ts'
import type {
  AttentionItem,
  MetricGap,
  MetricValue,
  PressureDimension,
  PressureDimensionReport,
  PressureMetric,
  PressureReport,
  PressureTier,
  SnapshotMetrics,
} from '../protocol/tracker.ts'
import { isRecord } from './json.ts'
import type {
  SourceRevision,
  Ticket,
  TicketAuthor,
  TicketHierarchy,
  TicketState,
} from './ticket.ts'

/** 本地快照库的格式版本。版本不符的条目一律按没有缓存处理。 */
export const SNAPSHOT_STORE_VERSION = 4

/** 缓存文件里存的后端类型。 */
const BACKENDS: readonly BackendKind[] = ['github', 'gitlab', 'gitea', 'markdown']

/** 缓存文件里认的父子能力。 */
const HIERARCHIES: readonly TicketHierarchy[] = ['native', 'convention', 'none']

/** 本地快照库里的一条记录：某个工作区最近一次成功拉取的工单数据。 */
export interface SnapshotStoreEntry {
  /** 格式版本；当前只认 {@link SNAPSHOT_STORE_VERSION}。 */
  readonly version: number
  /**
   * 仓库作用域根目录（该仓库的主 worktree 根目录）。
   * 同一仓库的多个 worktree 共用一份缓存：托管后端的缓存键就是它。
   */
  readonly scopeRoot: string
  /** 拉取这份数据的工作区根路径；本地 Markdown 的缓存键就是它。 */
  readonly workspaceRoot: string
  /** 拉取时的后端类型。 */
  readonly backend: BackendKind
  /** 拉取时的仓库显示名。 */
  readonly repository: string
  /**
   * 仓库身份：后端类型 + 实例主机 + 仓库路径。
   * 宿主用它确认这份缓存属于当前仓库；换远端或换后端时身份对不上，缓存作废。
   */
  readonly repositoryKey: string
  /** 拉取时的实例主机；本地 Markdown 为 null。 */
  readonly repositoryHost: string | null
  /** 拉取时刻（毫秒时间戳），也是下一次增量的窗口起点。 */
  readonly fetchedAt: number
  /** 拉取时的当前登录用户；本地 Markdown 与识别失败时为 null。 */
  readonly viewer: string | null
  /** 当时加载到的票数。 */
  readonly loaded: number
  /** 当时的仓库总票数。 */
  readonly total: number
  /** 还有下一页时的后端游标；缺省表示已经覆盖全部。 */
  readonly nextCursor?: string
  /** 当时拿到的工单原始数据，不含判定结果。 */
  readonly tickets: readonly Ticket[]
  /** 这份快照的父子能力来源；与工单的 `parent` 一起进出缓存。 */
  readonly hierarchy: TicketHierarchy
  /** 远端版本号；本地 Markdown 或后端给不出时为 null。 */
  readonly revision: SourceRevision | null
  /** 本地库的提交序号；没有本地库时为 0。 */
  readonly storeRevision: number
  /**
   * 写入时从同一份票数据算好的概览指标；读侧直接使用，不再重算。
   * 写操作改票后清空，下一次刷新写回。
   */
  readonly metrics?: SnapshotMetrics
}

/**
 * 写入用的条目：库版本与已加载数由存储层在提交时决定，
 * 调用方给不了也不该给，避免出现「传了却被忽略」的字段。
 */
export type SnapshotStoreInput = Omit<SnapshotStoreEntry, 'loaded' | 'storeRevision'>

/** meta 文件的内容：条目的全部字段，票数据换成引用列表。 */
export interface SnapshotStoreMeta {
  readonly version: number
  readonly storeRevision: number
  readonly scopeRoot: string
  readonly workspaceRoot: string
  readonly backend: BackendKind
  readonly repository: string
  readonly repositoryKey: string
  readonly repositoryHost: string | null
  readonly fetchedAt: number
  readonly viewer: string | null
  readonly total: number
  readonly nextCursor?: string
  readonly hierarchy: TicketHierarchy
  readonly revision: SourceRevision | null
  /** 当前提交里的票引用，顺序就是列表顺序。 */
  readonly ticketRefs: readonly string[]
  /** 这张表里当前被确认不存在的票引用。票重新出现时由写入路径清掉。 */
  readonly tombstones: readonly string[]
  /** 写入时算好的概览指标；读侧零计算。 */
  readonly metrics?: SnapshotMetrics
}

/**
 * 按版本区间读到的变化集。
 *
 * `tickets` 只包含最终状态是「存在」的变更票，`removed` 只包含最终状态是「不存在」
 * 的墓碑；同一张票在区间里先删后加只出现在 `tickets`，先加后删只出现在 `removed`。
 */
export interface SnapshotStoreChangeSet {
  readonly fromRevision: number
  readonly revision: number
  readonly tickets: readonly Ticket[]
  readonly removed: readonly string[]
}

/**
 * 把 meta 序列化成目录里的 meta 文件。
 * @param meta - 要保存的 meta。
 * @returns JSON 文本。
 */
export function serializeSnapshotStoreMeta(meta: SnapshotStoreMeta): string {
  return JSON.stringify({
    version: meta.version,
    storeRevision: meta.storeRevision,
    scopeRoot: meta.scopeRoot,
    workspaceRoot: meta.workspaceRoot,
    backend: meta.backend,
    repository: meta.repository,
    repositoryKey: meta.repositoryKey,
    repositoryHost: meta.repositoryHost,
    fetchedAt: meta.fetchedAt,
    viewer: meta.viewer,
    total: meta.total,
    ...(meta.nextCursor === undefined ? {} : { nextCursor: meta.nextCursor }),
    hierarchy: meta.hierarchy,
    revision: meta.revision,
    ticketRefs: meta.ticketRefs,
    tombstones: meta.tombstones,
    ...(meta.metrics === undefined ? {} : { metrics: meta.metrics }),
  })
}

/**
 * 解析 meta 文件。
 * @param raw - 文件里的 JSON 文本。
 * @returns 可用的 meta；格式版本不符或内容损坏时返回 undefined。
 */
export function parseSnapshotStoreMeta(raw: string): SnapshotStoreMeta | undefined {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return undefined
  }
  return readMeta(payload)
}

/**
 * 把一张票序列化成票文件。
 * @param ticket - 要保存的票。
 * @returns JSON 文本。
 */
export function serializeSnapshotTicket(ticket: Ticket): string {
  return JSON.stringify(ticket)
}

/**
 * 解析一张票文件。
 * @param raw - 文件里的 JSON 文本。
 * @returns 可用的票；内容损坏时返回 undefined。
 */
export function parseSnapshotTicket(raw: string): Ticket | undefined {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return undefined
  }
  return readTicket(payload)
}

/** 校验一份已解析的 meta。 */
function readMeta(value: unknown): SnapshotStoreMeta | undefined {
  if (!isRecord(value)) return undefined
  if (value.version !== SNAPSHOT_STORE_VERSION) return undefined

  const storeRevision = readCount(value.storeRevision)
  const workspaceRoot = readString(value.workspaceRoot)
  const scopeRoot = readString(value.scopeRoot)
  const repository = readString(value.repository)
  const repositoryKey = readString(value.repositoryKey)
  const fetchedAt = readNumber(value.fetchedAt)
  const total = readNumber(value.total)
  if (
    storeRevision === undefined ||
    workspaceRoot === undefined ||
    scopeRoot === undefined ||
    repository === undefined ||
    repositoryKey === undefined ||
    fetchedAt === undefined ||
    total === undefined
  ) {
    return undefined
  }

  const backend = value.backend
  if (typeof backend !== 'string' || !BACKENDS.includes(backend as BackendKind)) return undefined

  const repositoryHost = value.repositoryHost
  if (repositoryHost !== null && typeof repositoryHost !== 'string') return undefined

  // 当前用户是人员筛选的前提：字段缺失或类型不对时整份作废，不把旧数据当无身份。
  const viewer = value.viewer
  if (viewer !== null && typeof viewer !== 'string') return undefined
  if (typeof viewer === 'string' && viewer.length === 0) return undefined

  const nextCursor = value.nextCursor
  if (nextCursor !== undefined && (typeof nextCursor !== 'string' || nextCursor.length === 0)) {
    return undefined
  }

  const hierarchy = value.hierarchy
  if (typeof hierarchy !== 'string' || !HIERARCHIES.includes(hierarchy as TicketHierarchy)) {
    return undefined
  }

  const revision = readSourceRevision(value.revision)
  if (revision === undefined) return undefined

  const ticketRefs = readStringArray(value.ticketRefs)
  const tombstones = readStringArray(value.tombstones)
  if (ticketRefs === undefined || tombstones === undefined) return undefined
  // 指标损坏时只丢指标，读侧退回重算；票数据仍然可用。
  const metrics = readMetrics(value.metrics)

  return {
    version: SNAPSHOT_STORE_VERSION,
    storeRevision,
    scopeRoot,
    workspaceRoot,
    backend: backend as BackendKind,
    repository,
    repositoryKey,
    repositoryHost: repositoryHost ?? null,
    fetchedAt,
    viewer,
    total,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    hierarchy: hierarchy as TicketHierarchy,
    revision,
    ticketRefs,
    tombstones,
    ...(metrics === undefined ? {} : { metrics }),
  }
}

/** 校验写入时算好的概览指标；形状不对时当作没有，读侧重算。 */
function readMetrics(value: unknown): SnapshotMetrics | undefined {
  if (!isRecord(value)) return undefined
  const counts = ['openBacklog', 'readyCapacity', 'blockedRatio', 'needsTriage', 'stalled'] as const
  for (const key of counts) {
    if (typeof value[key] !== 'number') return undefined
  }

  const metricKeys = [
    'staleCount',
    'staleRatio',
    'oldestUpdateDays',
    'longestBlockerChain',
    'openedLast30Days',
    'closedLast30Days',
    'netFlow',
  ] as const
  const metrics: Partial<Record<(typeof metricKeys)[number], MetricValue>> = {}
  for (const key of metricKeys) {
    const metric = readMetricValue(value[key])
    if (metric === undefined) return undefined
    metrics[key] = metric
  }

  const coverage = value.coverage
  if (!isRecord(coverage) || typeof coverage.truncated !== 'boolean') return undefined
  const pressure = readPressure(value.pressure)
  if (pressure === undefined) return undefined
  const attention = readAttention(value.attention)
  if (attention === undefined) return undefined

  return {
    openBacklog: value.openBacklog as number,
    readyCapacity: value.readyCapacity as number,
    blockedRatio: value.blockedRatio as number,
    needsTriage: value.needsTriage as number,
    stalled: value.stalled as number,
    staleCount: metrics.staleCount as MetricValue,
    staleRatio: metrics.staleRatio as MetricValue,
    oldestUpdateDays: metrics.oldestUpdateDays as MetricValue,
    longestBlockerChain: metrics.longestBlockerChain as MetricValue,
    openedLast30Days: metrics.openedLast30Days as MetricValue,
    closedLast30Days: metrics.closedLast30Days as MetricValue,
    netFlow: metrics.netFlow as MetricValue,
    coverage: { truncated: coverage.truncated },
    pressure,
    attention,
  }
}

const GAPS: readonly MetricGap[] = ['no-timestamps', 'no-closed-time', 'no-dependency-edges']

function readMetricValue(value: unknown): MetricValue | undefined {
  if (!isRecord(value)) return undefined
  const metric = value.value
  if (metric !== null && typeof metric !== 'number') return undefined
  const gap = value.gap
  if (gap !== null && (typeof gap !== 'string' || !GAPS.includes(gap as MetricGap))) {
    return undefined
  }
  return { value: metric, gap: gap as MetricGap | null }
}

const TIERS: readonly PressureTier[] = ['light', 'normal', 'tight']
const DIMENSIONS: readonly PressureDimension[] = ['scale', 'blocking', 'freshness']
const PRESSURE_METRICS: readonly PressureMetric[] = [
  'backlog',
  'netFlow',
  'blockedRatio',
  'staleRatio',
  'stalled',
]

function readPressure(value: unknown): PressureReport | undefined {
  if (!isRecord(value)) return undefined
  const tier = readTier(value.tier)
  if (tier === undefined || !Array.isArray(value.dimensions)) return undefined
  const dimensions: PressureDimensionReport[] = []
  for (const item of value.dimensions) {
    const dimension = readPressureDimension(item)
    if (dimension === undefined) return undefined
    dimensions.push(dimension)
  }
  return { tier, dimensions }
}

function readTier(value: unknown): PressureTier | undefined {
  if (typeof value !== 'string' || !TIERS.includes(value as PressureTier)) return undefined
  return value as PressureTier
}

function readPressureDimension(value: unknown): PressureDimensionReport | undefined {
  if (!isRecord(value)) return undefined
  const dimension = value.dimension
  if (
    typeof dimension !== 'string' ||
    !DIMENSIONS.includes(dimension as PressureDimension)
  ) {
    return undefined
  }
  const tier = value.tier === null ? null : readTier(value.tier)
  if (tier === undefined) return undefined
  if (!Array.isArray(value.signals) || !Array.isArray(value.triggers) || !Array.isArray(value.gaps)) {
    return undefined
  }
  if (typeof value.provisional !== 'boolean') return undefined

  const signals = value.signals.map(readSignal)
  if (signals.some((signal) => signal === undefined)) return undefined
  const triggers = value.triggers.map(readPressureMetric)
  if (triggers.some((trigger) => trigger === undefined)) return undefined
  const gaps = value.gaps.map(readGap)
  if (gaps.some((gap) => gap === undefined)) return undefined

  return {
    dimension: dimension as PressureDimension,
    tier,
    signals: signals as { readonly metric: PressureMetric; readonly value: number }[],
    triggers: triggers as PressureMetric[],
    gaps: gaps as MetricGap[],
    provisional: value.provisional,
  }
}

function readSignal(
  value: unknown,
): { readonly metric: PressureMetric; readonly value: number } | undefined {
  if (!isRecord(value) || typeof value.value !== 'number') return undefined
  const metric = readPressureMetric(value.metric)
  return metric === undefined ? undefined : { metric, value: value.value }
}

function readPressureMetric(value: unknown): PressureMetric | undefined {
  if (typeof value !== 'string' || !PRESSURE_METRICS.includes(value as PressureMetric)) {
    return undefined
  }
  return value as PressureMetric
}

function readGap(value: unknown): MetricGap | undefined {
  if (typeof value !== 'string' || !GAPS.includes(value as MetricGap)) return undefined
  return value as MetricGap
}

const ATTENTION_REASONS: readonly AttentionItem['reason'][] = [
  'untriaged-bug',
  'stale',
  'most-blocking',
  'oldest-stalled',
]

function readAttention(value: unknown): readonly AttentionItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items: AttentionItem[] = []
  for (const item of value) {
    if (!isRecord(item)) return undefined
    const ref = readString(item.ref)
    const title = readString(item.title)
    const reason = item.reason
    if (
      ref === undefined ||
      title === undefined ||
      typeof reason !== 'string' ||
      !ATTENTION_REASONS.includes(reason as AttentionItem['reason'])
    ) {
      return undefined
    }
    const evidence = item.evidence
    if (evidence !== null && typeof evidence !== 'number') return undefined
    items.push({ ref, title, reason: reason as AttentionItem['reason'], evidence })
  }
  return items
}

/** 校验远端版本；null 合法，字段损坏时 undefined。 */
function readSourceRevision(value: unknown): SourceRevision | null | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  const id = readString(value.id)
  const total = readCount(value.total)
  if (id === undefined || total === undefined) return undefined
  return { id, total }
}

/** 校验一张票。 */
function readTicket(value: unknown): Ticket | undefined {
  if (!isRecord(value)) return undefined

  const ref = readString(value.ref)
  const title = readString(value.title)
  const createdAt = readString(value.createdAt)
  const updatedAt = readString(value.updatedAt)
  const state = readState(value.state)
  const openBlockers = readNumber(value.openBlockers)
  if (
    ref === undefined ||
    title === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    state === undefined ||
    openBlockers === undefined
  ) {
    return undefined
  }

  const number = value.number
  if (number !== null && (typeof number !== 'number' || !Number.isInteger(number))) return undefined

  const labels = readStringArray(value.labels)
  if (labels === undefined) return undefined

  const author = readAuthor(value.author)
  if (author === undefined) return undefined

  const assignees = readStringArray(value.assignees)
  if (assignees === undefined) return undefined

  const closedAt = value.closedAt
  if (closedAt !== undefined && typeof closedAt !== 'string') return undefined

  const parent = value.parent
  if (parent !== undefined && (typeof parent !== 'string' || parent.length === 0)) return undefined

  // 旧快照没有链接字段：按「这张票没有链接」处理，整份缓存仍然可用。
  const url = value.url
  if (url !== undefined && (typeof url !== 'string' || url.length === 0)) return undefined

  const blockedBy = value.blockedBy
  if (blockedBy !== undefined) {
    const refs = readStringArray(blockedBy)
    if (refs === undefined) return undefined
    return {
      ref,
      number: number ?? null,
      title,
      state,
      labels,
      author,
      assignees,
      createdAt,
      updatedAt,
      openBlockers,
      ...(closedAt === undefined ? {} : { closedAt }),
      blockedBy: refs,
      ...(parent === undefined ? {} : { parent }),
      ...(url === undefined ? {} : { url }),
    }
  }

  return {
    ref,
    number: number ?? null,
    title,
    state,
    labels,
    author,
    assignees,
    createdAt,
    updatedAt,
    openBlockers,
    ...(closedAt === undefined ? {} : { closedAt }),
    ...(parent === undefined ? {} : { parent }),
    ...(url === undefined ? {} : { url }),
  }
}

/** 校验创建人；本地 Markdown 没有创建人，整体为 null。 */
function readAuthor(value: unknown): TicketAuthor | null | undefined {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) return undefined
  const login = readString(value.login)
  if (login === undefined) return undefined
  const displayName = value.displayName
  if (displayName !== null && typeof displayName !== 'string') return undefined
  // 老快照里没有 avatarUrl 字段：按没有头像处理，整张票仍然可用。
  const avatarUrl = value.avatarUrl
  if (avatarUrl !== null && avatarUrl !== undefined && typeof avatarUrl !== 'string') {
    return undefined
  }
  return {
    login,
    displayName: displayName ?? null,
    avatarUrl: avatarUrl ?? null,
  }
}

/** 校验工单状态。 */
function readState(value: unknown): TicketState | undefined {
  if (value === 'open' || value === 'closed') return value
  return undefined
}

/** 读一个非空字符串。 */
function readString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value
}

/** 读一个有限数字。 */
function readNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

/** 读一个非负整数。 */
function readCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return undefined
  return value
}

/** 读一个字符串数组。 */
function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return undefined
    items.push(item)
  }
  return items
}
