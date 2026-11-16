/**
 * 工单详情视图的数据 hooks：读取详情、提交变更、按需读取补全候选、删除工单、Esc 返回。
 *
 * 写操作成功后重新读取详情（不做乐观更新），并刷新列表快照让徽标同步；
 * 详情头部的手动刷新保留已加载内容重读这张票，同样同步列表快照；
 * 删除成功后刷新列表并返回列表。
 */
import * as React from 'react'

import type {
  RpcErrorBody,
  TicketDetail,
  TicketOptions,
  TicketPatch,
  WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import { copyText } from './clipboard.ts'
import { errorText } from './error-text.ts'
import { useMessages, type Translate } from './i18n.ts'
import type { PanelClient } from './transport.ts'
import type { Suggestion, SuggestionSource } from './ticket-combobox.tsx'
import type { CopyState, OptionsState } from './ticket-detail-fields.tsx'

export interface DetailRequest {
  readonly detail: TicketDetail | null
  readonly error: RpcErrorBody | null
  readonly phase: 'loading' | 'ready' | 'error'
  readonly reload: () => void
  readonly replace: (detail: TicketDetail) => void
}

export function useDetailRequest(
  client: PanelClient,
  workspaceRoot: string,
  ref: string,
  number: number | null,
): DetailRequest {
  const [detail, setDetail] = React.useState<TicketDetail | null>(null)
  const [error, setError] = React.useState<RpcErrorBody | null>(null)
  const [phase, setPhase] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    let active = true
    // 换一张票时先清空，避免显示上一张票的残留内容。
    setDetail(null)
    setError(null)
    setPhase('loading')

    void client.getDetail(workspaceRoot, ref, number).then((result) => {
      if (!active) return
      if (result.ok) {
        setDetail(result.result)
        setPhase('ready')
        return
      }
      setError(result.error)
      setPhase('error')
    })

    return () => {
      active = false
    }
  }, [client, workspaceRoot, ref, number, attempt])

  return {
    detail,
    error,
    phase,
    reload: () => {
      setAttempt((value) => value + 1)
    },
    replace: setDetail,
  }
}

/** 手动刷新要重读的一张票。 */
export interface DetailRefreshTarget {
  readonly workspaceRoot: string
  readonly ref: string
  readonly number: number | null
}

/** 刷新结果落地的回调；`isCurrent` 为 false 时全部丢弃。 */
export interface DetailRefreshHooks {
  /** 视图仍在且目标没变时才返回 true；在途结果据此决定是否落地。 */
  readonly isCurrent: () => boolean
  readonly onDetail: (detail: TicketDetail) => void
  readonly onSnapshot: (snapshot: WorkspaceSnapshot) => void
  readonly onError: (error: RpcErrorBody) => void
}

/**
 * 重读一张票的详情，同时增量刷新列表快照。
 *
 * 两个请求并行、互不等待：详情先回来就先替换，列表快照稍后落地；
 * 详情失败只报告详情错误，列表刷新失败不改变详情内容（列表头部有自己的提示）。
 * @param client - 面板客户端。
 * @param target - 工作区与工单定位。
 * @param hooks - 落地回调与过期判断。
 * @returns 两个请求都结束后 resolve。
 */
export function refreshTicket(
  client: PanelClient,
  target: DetailRefreshTarget,
  hooks: DetailRefreshHooks,
): Promise<void> {
  const detail = client
    .getDetail(target.workspaceRoot, target.ref, target.number)
    .then((result) => {
      if (!hooks.isCurrent()) return
      if (result.ok) hooks.onDetail(result.result)
      else hooks.onError(result.error)
    })
  const snapshot = client.refresh(target.workspaceRoot).then((result) => {
    if (!hooks.isCurrent() || !result.ok) return
    hooks.onSnapshot(result.result)
  })
  return Promise.all([detail, snapshot]).then(() => undefined)
}

/** 详情头部手动刷新的状态与入口。 */
export interface DetailRefresh {
  readonly refreshing: boolean
  /** 最近一次刷新失败的原因；下一次刷新成功时清除。 */
  readonly error: RpcErrorBody | null
  readonly refresh: () => void
}

/**
 * 手动刷新当前这张票：保留已加载的详情重读，并同步列表快照。
 *
 * 刷新不走 {@link useDetailRequest} 的 `reload`：那条路径会清空详情并把阶段打回
 * loading，页面上会出现整页加载占位。这里只在失败时记录独立错误，成功时替换详情。
 * 只有最新一次读取能落地：引用、编号、工作区变化或组件卸载时丢弃旧结果。
 * @param client - 面板客户端。
 * @param target - 当前打开的工单。
 * @param onDetail - 读取成功后的详情。
 * @param onSnapshot - 列表快照读取成功后的回调。
 * @returns 刷新中标志、刷新错误与触发入口。
 */
export function useDetailRefresh(
  client: PanelClient,
  target: DetailRefreshTarget,
  onDetail: (detail: TicketDetail) => void,
  onSnapshot: (snapshot: WorkspaceSnapshot) => void,
): DetailRefresh {
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<RpcErrorBody | null>(null)
  const running = React.useRef(false)
  const mounted = React.useRef(true)
  const key = `${target.workspaceRoot}\n${target.ref}\n${String(target.number)}`
  const latest = React.useRef(key)
  latest.current = key

  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // 换票/换工作区后，上一张票的刷新错误不能挂在新详情下面。
  React.useEffect(() => {
    setError(null)
  }, [key])

  const refresh = (): void => {
    // state 更新是异步的，用 ref 立即拦住第二次点击。
    if (running.current) return
    running.current = true
    setRefreshing(true)
    const started = key
    const isCurrent = (): boolean => mounted.current && latest.current === started
    void refreshTicket(client, target, {
      isCurrent,
      onDetail: (detail) => {
        setError(null)
        onDetail(detail)
      },
      onSnapshot,
      onError: setError,
    }).finally(() => {
      running.current = false
      // 旧目标的结果不落地，但「刷新中」不能因此卡死：目标变了也恢复按钮。
      if (mounted.current) setRefreshing(false)
    })
  }

  return { refreshing, error, refresh }
}

export interface TicketMutation {
  readonly busy: boolean
  readonly error: RpcErrorBody | null
  readonly apply: (patch: TicketPatch) => void
}

export function useTicketMutation(
  client: PanelClient,
  options: {
    readonly workspaceRoot: string
    readonly ref: string
    readonly number: number | null
    readonly onUpdated: (detail: TicketDetail) => void
    /** 写操作后重建的快照：技能动作可能变了，详情头部据此更新徽标。 */
    readonly onSnapshot: (snapshot: WorkspaceSnapshot) => void
  },
): TicketMutation {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<RpcErrorBody | null>(null)
  const running = React.useRef(false)

  const apply = (patch: TicketPatch): void => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError(null)

    void (async () => {
      try {
        const result = await client.updateTicket(
          options.workspaceRoot,
          options.ref,
          options.number,
          patch,
        )
        if (!result.ok) {
          setError(result.error)
          return
        }

        // 写已落地：详情复查与列表刷新同时进行，任一失败都不影响另一项。
        // 列表徽标要同步；详情复查成功才替换显示值（不做乐观更新）。
        const [fresh, snapshot] = await Promise.all([
          client.getDetail(options.workspaceRoot, options.ref, options.number),
          client.refresh(options.workspaceRoot),
        ])
        if (snapshot.ok) options.onSnapshot(snapshot.result)
        if (!fresh.ok) {
          setError(fresh.error)
          return
        }
        options.onUpdated(fresh.result)
      } finally {
        running.current = false
        setBusy(false)
      }
    })()
  }

  return { busy, error, apply }
}

export function useEscapeKey(onBack: () => void): void {
  const handler = React.useRef(onBack)
  handler.current = onBack

  React.useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') handler.current()
    }
    window.addEventListener('keydown', listener)
    return () => {
      window.removeEventListener('keydown', listener)
    }
  }, [])
}

type OptionsLoad =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly options: TicketOptions }
  | { readonly status: 'failed'; readonly error: RpcErrorBody }

/**
 * 补全候选与标签颜色。标签颜色要在小块上显示，所以可写标签的后端在详情打开时就读一次；
 * 其余情况等用户展开编辑器才读。读取失败不影响手动输入。
 * @param client - 面板客户端。
 * @param workspaceRoot - 工作区根目录。
 * @param eager - 是否在挂载时就读取（详情可写标签时为 true）。
 * @returns 两组候选、标签颜色表与请求入口。
 */
export function useTicketOptions(
  client: PanelClient,
  workspaceRoot: string,
  eager: boolean,
): OptionsState {
  const t = useMessages()
  const [load, setLoad] = React.useState<OptionsLoad>({ status: 'idle' })
  const started = React.useRef(false)
  const mounted = React.useRef(true)

  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const request = React.useCallback((): void => {
    if (started.current) return
    started.current = true
    setLoad({ status: 'loading' })
    void client.getOptions(workspaceRoot).then((result) => {
      if (!mounted.current) return
      setLoad(
        result.ok
          ? { status: 'ready', options: result.result }
          : { status: 'failed', error: result.error },
      )
    })
  }, [client, workspaceRoot])

  React.useEffect(() => {
    if (eager) request()
  }, [eager, request])

  return React.useMemo(() => optionsState(load, request, t), [load, request, t])
}

function optionsState(load: OptionsLoad, request: () => void, t: Translate): OptionsState {
  if (load.status !== 'ready') {
    const source: SuggestionSource =
      load.status === 'failed'
        ? {
            status: 'unavailable',
            reason: t('detail.optionsFailed', { detail: errorText(load.error, t) }),
          }
        : { status: 'loading' }
    return { labels: source, assignees: source, labelColors: new Map(), request }
  }

  const labels: Suggestion[] = load.options.labels.map((label) => ({
    value: label.name,
    detail: label.description,
    color: label.color ?? 'transparent',
  }))
  const assignees: Suggestion[] = load.options.assignees.map((user) => ({
    value: user.username,
    detail: user.name,
    color: null,
  }))
  const labelColors = new Map<string, string>()
  for (const label of load.options.labels) {
    if (label.color !== null) labelColors.set(label.name, label.color)
  }

  return {
    labels: { status: 'ready', items: labels },
    assignees: { status: 'ready', items: assignees },
    labelColors,
    request,
  }
}

/** 删除工单的状态与入口。 */
export interface TicketDeletion {
  /** 确认面板是否打开。 */
  readonly confirming: boolean
  readonly deleting: boolean
  readonly error: RpcErrorBody | null
  readonly open: () => void
  readonly cancel: () => void
  readonly confirm: () => void
}

/**
 * 删除流程：打开确认面板 → 用户输入确认词 → 删除 → 刷新列表并返回列表。
 * 删除失败时留在面板里显示原因，不返回列表。
 * @param client - 面板客户端。
 * @param target - 工作区与工单定位，以及删除成功后的去处。
 * @returns 删除状态与入口。
 */
export function useTicketDeletion(
  client: PanelClient,
  target: {
    readonly workspaceRoot: string
    readonly ref: string
    readonly number: number | null
    readonly onDeleted: () => void
  },
): TicketDeletion {
  const [confirming, setConfirming] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [error, setError] = React.useState<RpcErrorBody | null>(null)

  const confirm = (): void => {
    if (deleting) return
    setDeleting(true)
    setError(null)
    void (async () => {
      const result = await client.deleteTicket(target.workspaceRoot, target.ref, target.number)
      if (!result.ok) {
        setError(result.error)
        setDeleting(false)
        return
      }
      // 删除已落地：刷新列表快照再返回，列表里不会残留这张票。
      await client.refresh(target.workspaceRoot)
      target.onDeleted()
    })()
  }

  return {
    confirming,
    deleting,
    error,
    open: () => {
      setError(null)
      setConfirming(true)
    },
    cancel: () => {
      setConfirming(false)
      setError(null)
    },
    confirm,
  }
}

/** “已复制”对勾停留的时长。 */
const COPIED_RESET_MS = 2000

/**
 * 复制链接：成功后两秒回到 idle（图标从对勾变回链接）；失败保持，直到下一次复制。
 * @param url - 工单地址；null 时复制不做任何事。
 * @returns 复制状态与触发入口。
 */
export function useCopyLink(url: string | null): {
  readonly copy: CopyState
  readonly onCopy: () => void
} {
  const t = useMessages()
  const [copy, setCopy] = React.useState<CopyState>({ status: 'idle' })

  React.useEffect(() => {
    if (copy.status !== 'copied') return
    const timer = setTimeout(() => {
      setCopy({ status: 'idle' })
    }, COPIED_RESET_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [copy])

  return {
    copy,
    onCopy: () => {
      if (url === null) return
      void copyText(url).then((outcome) => {
        setCopy(
          outcome.status === 'copied'
            ? { status: 'copied' }
            : { status: 'failed', message: t('copy.clipboardUnavailable') },
        )
      })
    },
  }
}
