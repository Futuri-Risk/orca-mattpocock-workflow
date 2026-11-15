/**
 * 面板 RPC 桥。
 *
 * 面板用 `orca.plugin.request(name, input)` 找 worker 里的同名处理器，
 * 所以这里按协议里的方法名逐个注册，入参与出参形状保持不变。
 */
import { isRecord } from '../core/json.ts'
import { LOG_EVENTS } from '../protocol/log-events.ts'
import {
  AVATAR_READ_METHOD,
  ERROR_CODES,
  RPC_METHODS,
  type RpcResult,
} from '../protocol/tracker.ts'
import type { AvatarService } from './avatar-service.ts'
import type { EnvCheckService } from './env-check-service.ts'
import type { LogSink } from './log.ts'
import type { OrcaWorkerApi } from './orca-types.ts'
import { readWorkspaceRoot } from './rpc-params.ts'
import type { SnapshotService } from './snapshot-service.ts'
import { installPoolSkills } from './skill-installer.ts'
import type { TicketService } from './ticket-service.ts'
import type { TicketWorktreeService } from './ticket-worktree-service.ts'
import type {
  WorkspaceCandidate,
  WorkspaceResolution,
  WorkspaceResolver,
} from './workspace-resolver.ts'

/** 面板事件：工作区无法唯一确定时把候选列表推给面板。 */
export const WORKSPACE_CANDIDATES_EVENT = 'workspace.candidates'

/**
 * 最近一次推给面板的失败候选。
 *
 * 聚焦上下文没变时，同样的候选再推一遍不会多出任何可选信息，只会把面板与日志刷成噪声。
 * 上下文变化（`workspace.changed`）或认领成功后清空，让下一次失败仍能推一次。
 */
let reportedCandidates: string | undefined

/** 聚焦上下文变化后允许重新推送一次候选。 */
export function resetWorkspaceCandidatesReport(): void {
  reportedCandidates = undefined
}

/** 面板事件：命令触发的一次全量刷新完成。 */
export const SNAPSHOT_REFRESHED_EVENT = 'snapshot.refreshed'

/** 面板请求名：安装入池技能。这个动作不属于工单 RPC，单独一个处理器。 */
export const SKILL_INSTALL_REQUEST = 'skills.install'
/** 把工作区切到 Orca 前台的请求名。 */
export const OPEN_WORKSPACE_REQUEST = 'workspace.open'

/**
 * 面板请求名：读取 worker 当前认领的工作区与候选。
 *
 * 候选不只靠推送：面板启动与 `workspace.changed` 后主动问一次，
 * 面板重载或多面板时不会因为推送去重而丢掉选择区。
 */
export const WORKSPACE_CURRENT_REQUEST = 'workspace.current'

/** 桥接依赖。 */
export interface RpcBridgeDeps {
  readonly snapshot: SnapshotService
  readonly ticket: TicketService
  readonly worktree: TicketWorktreeService
  readonly envCheck: EnvCheckService
  readonly workspace: WorkspaceResolver
  readonly avatar: AvatarService
  readonly log: LogSink
}

/**
 * 注册全部 RPC 处理器与入池技能安装处理器。
 * @param orca - worker API。
 * @param deps - 服务依赖。
 */
export function registerRpcHandlers(orca: OrcaWorkerApi, deps: RpcBridgeDeps): void {
  for (const method of Object.values(RPC_METHODS)) {
    orca.panels.handle(method, async (input) => {
      const prepared = await prepareParams(deps, orca, method, input)
      if (!prepared.ok) return prepared.result
      return dispatch(deps, method, prepared.params)
    })
  }

  orca.panels.handle(OPEN_WORKSPACE_REQUEST, async (input) => {
    const path = isRecord(input) && typeof input['path'] === 'string' ? input['path'] : undefined
    const target = await resolveWorkspaceTarget(orca, deps, path)
    if (target === undefined) {
      return {
        ok: false,
        error: {
          code: ERROR_CODES.invalidParams,
          message: path === undefined ? '认不到当前工作区。' : `Orca 里没有这个工作区：${path}`,
        },
      }
    }
    await orca.host.call('workspace.open', { workspaceId: target.id })
    // 记住它：同一聚焦上下文里后续省略 workspaceRoot 的请求都沿用它。
    await deps.workspace.prefer(target.path)
    return { ok: true, result: { opened: true, path: target.path } }
  })

  orca.panels.handle(SKILL_INSTALL_REQUEST, async () => {
    try {
      return { ok: true, result: await installPoolSkills() }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: ERROR_CODES.internal,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  })

  // 头像代理：面板 frame 没有网络，远端图片必须由 worker 下载后以 data URL 返回。
  orca.panels.handle(AVATAR_READ_METHOD, (input, context) =>
    deps.avatar.read(input, context.signal),
  )

  orca.panels.handle(WORKSPACE_CURRENT_REQUEST, async () => {
    // 面板每次启动或聚焦上下文变化都问一次：重新按当前线索认领，
    // 候选随响应返回，不依赖推送是否被去重抑制。
    deps.workspace.invalidate()
    const resolution = await deps.workspace.resolve()
    if (resolution.status === 'resolved') {
      return {
        ok: true,
        result: { root: resolution.root, contextKey: resolution.contextKey, candidates: [] },
      }
    }
    reportWorkspaceFailure(orca, resolution, deps.log)
    return {
      ok: true,
      result: {
        root: null,
        contextKey: resolution.contextKey,
        candidates: panelCandidates(resolution.candidates),
      },
    }
  })
}

/** 按方法名分发到对应服务。 */
function dispatch(deps: RpcBridgeDeps, method: string, params: unknown): Promise<RpcResult<unknown>> {
  if (method === RPC_METHODS.envCheck) return deps.envCheck.handle(method, params)
  if (method === RPC_METHODS.snapshotCache) return deps.snapshot.cache(params)
  if (method === RPC_METHODS.ticketWorktree) return deps.worktree.handle(method, params)
  if (
    method === RPC_METHODS.ticketGet ||
    method === RPC_METHODS.ticketUpdate ||
    method === RPC_METHODS.ticketOptions ||
    method === RPC_METHODS.ticketDelete
  ) {
    return deps.ticket.handle(method, params)
  }
  return deps.snapshot.handle(method, params)
}

/** 准备好请求参数：面板没给工作区时由 worker 自己解析。 */
async function prepareParams(
  deps: RpcBridgeDeps,
  orca: OrcaWorkerApi,
  method: string,
  input: unknown,
): Promise<{ readonly ok: true; readonly params: unknown } | { readonly ok: false; readonly result: RpcResult<unknown> }> {
  // 面板显式给了工作区（用户在候选里选过）：记住它，后续省略 workspaceRoot 的请求
  // 与刷新命令都沿用它。
  const explicit = readWorkspaceRoot(input)
  if (explicit !== undefined) {
    await deps.workspace.prefer(explicit)
    // 用户重新选过：上一次失败推过的候选不再代表当前状态，下次失败要能再提示一次。
    resetWorkspaceCandidatesReport()
    return { ok: true, params: input }
  }

  // 用户主动刷新：放掉上一次认领结果，允许按当前线索重新试一次。
  if (method === RPC_METHODS.snapshotRefresh) deps.workspace.invalidate()

  const resolution = await deps.workspace.resolve()
  if (resolution.status === 'resolved') {
    resetWorkspaceCandidatesReport()
    const base = isRecord(input) ? input : {}
    return { ok: true, params: { ...base, workspaceRoot: resolution.root } }
  }

  reportWorkspaceFailure(orca, resolution, deps.log)
  return {
    ok: false,
    result: {
      ok: false,
      error: {
        code: ERROR_CODES.invalidParams,
        message: workspaceFailureMessage(resolution),
      },
    },
  }
}

/** 认领不到工作区的解析结果。 */
type WorkspaceFailure = Exclude<WorkspaceResolution, { status: 'resolved' }>

/**
 * 通知面板认领失败，并把候选推一次。
 *
 * 同一份候选只推一次：聚焦上下文没变时重试不可能成功，反复推只会把面板与日志刷成噪声。
 * 聚焦上下文变化后由 {@link resetWorkspaceCandidatesReport} 放行下一次推送。
 * @param orca - worker API。
 * @param resolution - 失败结果。
 * @param log - 日志出口。
 */
export function reportWorkspaceFailure(
  orca: OrcaWorkerApi,
  resolution: WorkspaceFailure,
  log: LogSink,
): void {
  const ids = resolution.candidates
    .map((candidate) => candidate.id)
    .sort()
    .join('\u0001')
  const key = `${resolution.contextKey}\u0000${resolution.status}\u0000${ids}`
  if (key === reportedCandidates) return
  reportedCandidates = key
  postWorkspaceCandidates(orca, resolution)
  log('warn', LOG_EVENTS.snapshot, {
    result: 'error',
    reason: resolution.status,
    candidates: resolution.candidates.length,
  })
}

/**
 * 认领失败时的提示：有候选就指向面板顶部的选择区，没有就指向 Orca 自己的工作区。
 * @param resolution - 失败结果。
 * @returns 一句可操作的提示。
 */
export function workspaceFailureMessage(resolution: WorkspaceFailure): string {
  if (resolution.candidates.length > 0) {
    return '无法确定当前工作区。请在面板顶部点「使用」选择一个工作区后重试。'
  }
  return '没有可用的工作区。请先在 Orca 里打开一个仓库后重试。'
}

/**
 * 推给面板的候选形状。
 *
 * 分支在面板侧是字符串：没有分支的工作区（普通文件夹）传空串，
 * 面板按「无分支」渲染，不会把这类候选丢掉。`contextKey` 让面板判断
 * `workspace.changed` 之后用户的选择是否还有效。
 */
interface PanelWorkspaceCandidates {
  readonly contextKey: string
  readonly candidates: readonly PanelWorkspaceCandidate[]
}

/** 一条候选：字段都在面板侧可展示、可区分。 */
interface PanelWorkspaceCandidate {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly branch: string
  readonly project: string
  readonly kind: string
}

/** 把候选转成面板侧可展示、可区分的一行。 */
function panelCandidates(
  candidates: readonly WorkspaceCandidate[],
): readonly PanelWorkspaceCandidate[] {
  return candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    path: candidate.path,
    branch: candidate.branch ?? '',
    project: candidate.project ?? '',
    kind: candidate.kind,
  }))
}

/**
 * 把失败结果里的候选工作区推给面板。
 * @param orca - worker API。
 * @param resolution - 失败结果。
 */
function postWorkspaceCandidates(
  orca: OrcaWorkerApi,
  resolution: WorkspaceFailure,
): void {
  const payload: PanelWorkspaceCandidates = {
    contextKey: resolution.contextKey,
    candidates: panelCandidates(resolution.candidates),
  }
  orca.panels.post(WORKSPACE_CANDIDATES_EVENT, payload)
}

/**
 * 找出要打开的工作区。
 *
 * 给了路径就按路径找；没给就用聚焦工作区。
 * @param orca - worker API。
 * @param deps - 服务依赖。
 * @param path - 工作区绝对路径。
 * @returns 工作区条目；找不到时是 undefined。
 */
async function resolveWorkspaceTarget(
  orca: OrcaWorkerApi,
  deps: RpcBridgeDeps,
  path: string | undefined,
): Promise<{ readonly id: string; readonly path: string } | undefined> {
  if (path !== undefined) {
    const list = await orca.host.call('workspace.list').catch(() => null)
    if (!isRecord(list) || !Array.isArray(list['workspaces'])) return undefined
    for (const entry of list['workspaces']) {
      if (!isRecord(entry) || entry['path'] !== path) continue
      const id = entry['id']
      if (typeof id === 'string') return { id, path }
    }
    return undefined
  }

  const resolution = await deps.workspace.resolve()
  if (resolution.status !== 'resolved') return undefined
  return { id: resolution.candidate.id, path: resolution.root }
}
