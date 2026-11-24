/**
 * 面板共用的快照请求：首屏只等列表，阻塞信息由后台补齐。
 * 列表、概览与详情读同一份状态，这里只实现一次。
 *
 * 数据来自本地快照库时先把缓存显示出来，再自动发起一次增量刷新；
 * 刷新回包有三种：not-modified 保留行数据但清掉陈旧标记，delta 只合并变化行与墓碑，
 * 整份回包替换当前列表。刷新失败保留已有数据，只把失败原因记在状态里。
 */
import * as React from 'react'

import type {
  RpcErrorBody,
  SnapshotBaseline,
  SnapshotDelta,
  SnapshotRefreshResult,
  WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import { useMessages, type Translate } from './i18n.ts'
import type { PanelClient } from './transport.ts'

/** 请求阶段。 */
export type SnapshotPhase = 'loading' | 'ready' | 'refreshing' | 'error'

export interface SnapshotRequestState {
  readonly snapshot: WorkspaceSnapshot | null
  /** 整体错误：连一份数据都没有时才出现。 */
  readonly error: RpcErrorBody | null
  /** 最近一次刷新失败的原因；有数据时用它提示，列表本身照常显示。 */
  readonly refreshError: RpcErrorBody | null
  readonly phase: SnapshotPhase
  /** 增量刷新：能只拉变化就只拉变化。 */
  readonly refresh: () => void
  /** 全量刷新：忽略本地快照库重拉一次。 */
  readonly refreshFull: () => void
  /** 详情刷新或写操作拿到的刷新回包：按整份 / delta / not-modified 落地。 */
  readonly applyRefresh: (result: SnapshotRefreshResult) => void
  /** 正在取下一页；界面据此禁用「加载更多」。 */
  readonly appending: boolean
  /** 取下一页并追加到当前列表；没有更多时宿主原样返回。 */
  readonly loadMore: () => void
}

/** 请求方式：读缓存、增量刷新、全量刷新。 */
type RequestMode = 'get' | 'refresh' | 'refresh-full'

/**
 * 快照旁边要显示的失败原因。
 * 客户端刚失败的原因优先，其次是宿主记在快照里的原因；两者都没有但数据陈旧时，
 * 说明数据不是最新的。
 * @param snapshot - 当前快照；没有数据时为 null。
 * @param refreshError - 客户端最近一次刷新失败的原因。
 * @param t - 当前语言的翻译函数。
 * @returns 要显示的原因文案；没有原因时为 null。
 */
export function snapshotRefreshNotice(
  snapshot: WorkspaceSnapshot | null,
  refreshError: RpcErrorBody | null,
  t: Translate,
): string | null {
  if (refreshError !== null) return refreshError.message
  const hostMessage = snapshot?.refreshError?.message
  if (hostMessage !== undefined) return hostMessage
  if (snapshot?.stale === true) return t('error.staleData')
  return null
}

/**
 * 把增量回包合并进当前快照。
 *
 * - 墓碑从列表里拿掉；
 * - 变化行按引用替换，位置不变；新行按回包顺序接在末尾；
 * - 指标、计数与数据时间取宿主回包（服务端同源算好）。
 *
 * @param current - 当前显示的整份快照。
 * @param delta - 宿主回的变化行与墓碑。
 * @returns 合并后的整份快照。
 */
export function applySnapshotDelta(
  current: WorkspaceSnapshot,
  delta: SnapshotDelta,
): WorkspaceSnapshot {
  const removed = new Set(delta.removed)
  const changed = new Map(delta.changed.map((ticket) => [ticket.ref, ticket] as const))
  const tickets = current.tickets.flatMap((ticket) => {
    if (removed.has(ticket.ref)) return []
    return [changed.get(ticket.ref) ?? ticket]
  })
  const present = new Set(tickets.map((ticket) => ticket.ref))
  for (const ticket of delta.changed) {
    if (present.has(ticket.ref)) continue
    tickets.push(ticket)
    present.add(ticket.ref)
  }

  return {
    backend: delta.backend,
    repository: delta.repository,
    repositoryHost: delta.repositoryHost,
    fetchedAt: delta.fetchedAt,
    viewer: delta.viewer,
    loaded: delta.loaded,
    total: delta.total,
    hasMore: delta.hasMore,
    hierarchy: delta.hierarchy,
    metrics: delta.metrics,
    blockersFinalized: delta.blockersFinalized,
    source: delta.source,
    stale: delta.stale,
    refreshError: delta.refreshError,
    revision: delta.revision,
    storeRevision: delta.storeRevision,
    tickets,
  }
}

/**
 * 把刷新回包落到当前快照上；not-modified 保留行数据但标成已核验的最新，
 * delta 需要当前基线。
 * @param current - 当前快照。
 * @param result - 刷新回包。
 * @returns 落地后的快照；没有基线可合并时是 current 或 null。
 */
export function applyRefreshResult(
  current: WorkspaceSnapshot | null,
  result: SnapshotRefreshResult,
): WorkspaceSnapshot | null {
  if (result.kind === 'snapshot') return result.snapshot
  if (result.kind === 'not-modified') {
    if (current === null) return null
    // 这次刷新成功核对了数据没变：清掉陈旧提示与本地缓存徽标，数据时间推进到核对时刻。
    return {
      ...current,
      source: 'live',
      stale: false,
      refreshError: null,
      fetchedAt: result.fetchedAt,
      revision: result.revision ?? current.revision,
      storeRevision: result.storeRevision,
    }
  }
  return current === null ? null : applySnapshotDelta(current, result)
}

/** 一次请求的结果：落地后的数据与这次是否已经由远端确认。 */
interface LoadOutcome {
  readonly snapshot: WorkspaceSnapshot | null
  /** 这次请求已经到过远端（整份或 not-modified）或合并了增量。 */
  readonly settled: boolean
}

/**
 * 从当前快照取刷新基线。没有快照、或库版本还是初始值时返回 null，
 * 宿主据此回整份而不是拿一个空基线去比对。
 * @param snapshot - 当前显示的整份快照。
 * @returns 刷新参数里的库版本基线。
 */
export function snapshotBaselineOf(snapshot: WorkspaceSnapshot | null): SnapshotBaseline | null {
  if (snapshot === null || snapshot.storeRevision <= 0) return null
  return { storeRevision: snapshot.storeRevision }
}

/** 一次请求的结果：已应用的数据，或失败时的 null。 */
interface Loader {
  readonly snapshot: WorkspaceSnapshot | null
  readonly error: RpcErrorBody | null
  readonly refreshError: RpcErrorBody | null
  readonly phase: SnapshotPhase
  readonly appending: boolean
  readonly load: (mode: RequestMode) => Promise<LoadOutcome | null>
  readonly applyRefresh: (result: SnapshotRefreshResult) => void
  readonly append: () => Promise<void>
}

/**
 * 读取一个工作区的快照，并在首屏之后补齐阻塞信息。
 * @param client - 面板客户端。
 * @param workspaceRoot - 当前工作区；没有工作区时直接进入错误态。
 * @param reloadToken - 外部推送的刷新信号；变了就重新读一次。
 * @returns 快照、错误、阶段、两个刷新入口与「加载更多」。
 */
export function useSnapshotRequest(
  client: PanelClient,
  workspaceRoot: string | undefined,
  reloadToken = 0,
): SnapshotRequestState {
  const {
    snapshot,
    error,
    refreshError,
    phase,
    appending,
    load,
    applyRefresh,
    append,
  } = useSnapshotLoader(client, workspaceRoot)
  // 一轮缓存只自动刷新一次：刷新失败时不再反复打宿主。
  const autoRefreshed = React.useRef(false)

  const run = React.useCallback(
    async (mode: RequestMode): Promise<void> => {
      const applied = await load(mode)
      if (applied === null || applied.snapshot === null) return
      if (applied.settled) {
        autoRefreshed.current = false
        return
      }
      // 来自本地快照库：数据已经显示出来，再自动刷新一次让它收敛到最新。
      if (autoRefreshed.current) return
      autoRefreshed.current = true
      const refreshed = await load('refresh')
      if (refreshed !== null && refreshed.settled) autoRefreshed.current = false
    },
    [load],
  )

  React.useEffect(() => {
    autoRefreshed.current = false
    void run('get')
  }, [run, reloadToken])

  const refresh = React.useCallback(() => {
    if (phase === 'loading' || phase === 'refreshing') return
    void run('refresh')
  }, [phase, run])

  const refreshFull = React.useCallback(() => {
    if (phase === 'loading' || phase === 'refreshing') return
    void run('refresh-full')
  }, [phase, run])

  const loadMore = React.useCallback(() => {
    if (phase === 'loading' || phase === 'refreshing' || appending) return
    void append()
  }, [appending, append, phase])

  return {
    snapshot,
    error,
    refreshError,
    phase,
    refresh,
    refreshFull,
    applyRefresh,
    appending,
    loadMore,
  }
}

/**
 * 快照的读取与落地：一次请求、一次落地，失败时按有没有旧数据决定去留。
 * @param client - 面板客户端。
 * @param workspaceRoot - 当前工作区。
 * @returns 当前状态与发起请求的入口。
 */
function useSnapshotLoader(client: PanelClient, workspaceRoot: string | undefined): Loader {
  const t = useMessages()
  const [snapshot, setSnapshot] = React.useState<WorkspaceSnapshot | null>(null)
  const [error, setError] = React.useState<RpcErrorBody | null>(null)
  const [refreshError, setRefreshError] = React.useState<RpcErrorBody | null>(null)
  const [phase, setPhase] = React.useState<SnapshotPhase>('loading')
  const [appending, setAppending] = React.useState(false)
  const sequence = React.useRef(0)
  // 刷新要带回当前基线的两个版本；state 更新是异步的，用 ref 立即读到最新值。
  const current = React.useRef<WorkspaceSnapshot | null>(null)
  // 已经拿到过数据：刷新失败时要靠它决定是保留列表还是切错误页。
  const hasData = React.useRef(false)
  // 详情里的异步刷新可能在换工作区之后才落地；旧仓库的快照不能写进新仓库。
  const workspace = React.useRef(workspaceRoot)
  workspace.current = workspaceRoot
  // 防连点：state 更新是异步的，用 ref 立即拦住第二次点击。
  const appendingRef = React.useRef(false)

  const commit = React.useCallback((next: WorkspaceSnapshot): void => {
    current.current = next
    hasData.current = true
    setSnapshot(next)
    setError(null)
    setRefreshError(null)
    setPhase('ready')
  }, [])

  const load = React.useCallback(
    async (mode: RequestMode): Promise<LoadOutcome | null> => {
      const request = sequence.current + 1
      sequence.current = request

      if (workspaceRoot === undefined) {
        current.current = null
        hasData.current = false
        setSnapshot(null)
        setError({ code: 'invalid-params', message: t('error.noWorkspaceTickets') })
        setPhase('error')
        return null
      }

      setPhase(mode === 'get' ? 'loading' : 'refreshing')
      setError(null)
      const baseline = snapshotBaselineOf(current.current)
      const options = {
        ...(mode === 'refresh-full' ? { full: true } : {}),
        ...(baseline ?? {}),
      }
      const result =
        mode === 'get'
          ? await client.get(workspaceRoot)
          : Object.keys(options).length === 0
            ? await client.refresh(workspaceRoot)
            : await client.refresh(workspaceRoot, options)
      if (request !== sequence.current) return null

      if (!result.ok) {
        // 刷新失败时保留已有数据：不清空列表、不切错误页，只把原因记下来。
        if (mode === 'get' || !hasData.current) {
          setError(result.error)
          setPhase('error')
          return null
        }
        setRefreshError(result.error)
        setPhase('ready')
        return { snapshot: current.current, settled: false }
      }

      const isRefresh = 'kind' in result.result
      const next = isRefresh
        ? applyRefreshResult(current.current, result.result)
        : result.result
      if (next === null) {
        // delta 到达时没有基线（理论上只在面板刚挂载时发生）：退回整份读取。
        const full = await client.get(workspaceRoot)
        if (request !== sequence.current) return null
        if (!full.ok) {
          setError(full.error)
          setPhase('error')
          return null
        }
        commit(full.result)
        return { snapshot: full.result, settled: true }
      }

      commit(next)
      let applied = next

      if (!applied.blockersFinalized) {
        const finalized = await client.resolveBlockers(workspaceRoot)
        // 刷新会推进序号；旧补齐结果不能覆盖新列表。
        if (request !== sequence.current) return null
        // 补齐失败保留首屏结果：列表已经可用，不弹错误横幅。
        if (finalized.ok) {
          commit(finalized.result)
          applied = finalized.result
        }
      }

      return { snapshot: applied, settled: mode !== 'get' || applied.source === 'live' }
    },
    [client, commit, workspaceRoot, t],
  )

  // 换工作区时清掉上一份数据，不让旧仓库的票留在新仓库的列表里。
  React.useEffect(() => {
    current.current = null
    hasData.current = false
    setSnapshot(null)
    setError(null)
    setRefreshError(null)
  }, [workspaceRoot])

  /**
   * 取下一页并追加。不推进序号：并发的刷新结果仍然有效；
   * 自己这一页只在序号没变时落地，避免覆盖刚刷新出来的列表。
   */
  const append = React.useCallback(async (): Promise<void> => {
    if (appendingRef.current || workspaceRoot === undefined) return

    const started = sequence.current
    appendingRef.current = true
    setAppending(true)
    try {
      const result = await client.loadMore(workspaceRoot)
      if (started !== sequence.current) return
      if (!result.ok) {
        // 列表已经有数据：保留它，只把失败原因记下来，用户可以再点一次。
        if (hasData.current) setRefreshError(result.error)
        return
      }
      commit(result.result)
    } finally {
      appendingRef.current = false
      setAppending(false)
    }
  }, [client, commit, workspaceRoot])

  /** 快照尚未定稿时补做一次阻塞补齐；旧一代的结果不覆盖新列表。 */
  const applyBlockersLater = React.useCallback(
    (applied: WorkspaceSnapshot, started = sequence.current): void => {
      if (applied.blockersFinalized || workspaceRoot === undefined) return
      void client.resolveBlockers(workspaceRoot).then((finalized) => {
        if (!finalized.ok) return
        if (workspace.current !== workspaceRoot || sequence.current !== started) return
        commit(finalized.result)
      })
    },
    [client, commit, workspaceRoot],
  )

  /**
   * 写回一次刷新回包：not-modified 保留行数据并清掉陈旧标记，delta 只合并变化行。
   * 不推进请求序号，旧仓库的在途结果不落地。
   */
  const applyRefresh = React.useCallback(
    (result: SnapshotRefreshResult): void => {
      if (workspaceRoot === undefined || workspace.current !== workspaceRoot) return
      const started = sequence.current
      const next = applyRefreshResult(current.current, result)
      if (next === null) return
      commit(next)
      applyBlockersLater(next, started)
    },
    [applyBlockersLater, commit, workspaceRoot],
  )

  return {
    snapshot,
    error,
    refreshError,
    phase,
    appending,
    load,
    applyRefresh,
    append,
  }
}
