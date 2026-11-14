/**
 * 面板 RPC 桥。
 *
 * 原实现把 RPC 挂在 DSH 的私有 HTTP 路由上；Orca 里面板用
 * `orca.plugin.request(name, input)` 找 worker 里的同名处理器，
 * 所以这里按协议里的方法名逐个注册，入参与出参形状保持不变。
 */
import { isRecord } from '../core/json.ts'
import { LOG_EVENTS } from '../protocol/log-events.ts'
import { ERROR_CODES, RPC_METHODS, type RpcResult } from '../protocol/tracker.ts'
import type { EnvCheckService } from './env-check-service.ts'
import type { LogSink } from './log.ts'
import type { OrcaWorkerApi } from './orca-types.ts'
import { readWorkspaceRoot } from './rpc-params.ts'
import type { SnapshotService } from './snapshot-service.ts'
import { installPoolSkills } from './skill-installer.ts'
import type { TicketService } from './ticket-service.ts'
import type { WorkspaceCandidate, WorkspaceResolver } from './workspace-resolver.ts'

/** 面板事件：工作区无法唯一确定时把候选列表推给面板。 */
export const WORKSPACE_CANDIDATES_EVENT = 'workspace.candidates'

/** 面板事件：命令触发的一次全量刷新完成。 */
export const SNAPSHOT_REFRESHED_EVENT = 'snapshot.refreshed'

/** 面板请求名：安装入池技能。这个动作不属于工单 RPC，单独一个处理器。 */
export const SKILL_INSTALL_REQUEST = 'skills.install'

/** 桥接依赖。 */
export interface RpcBridgeDeps {
  readonly snapshot: SnapshotService
  readonly ticket: TicketService
  readonly envCheck: EnvCheckService
  readonly workspace: WorkspaceResolver
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
      const prepared = await prepareParams(deps, orca, input)
      if (!prepared.ok) return prepared.result
      return dispatch(deps, method, prepared.params)
    })
  }
}

/** 按方法名分发到对应服务。 */
function dispatch(deps: RpcBridgeDeps, method: string, params: unknown): Promise<RpcResult<unknown>> {
  if (method === RPC_METHODS.envCheck) return deps.envCheck.handle(method, params)
  if (method === RPC_METHODS.snapshotCache) return deps.snapshot.cache(params)
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
  input: unknown,
): Promise<{ readonly ok: true; readonly params: unknown } | { readonly ok: false; readonly result: RpcResult<unknown> }> {
  // 面板显式给了工作区（用户在候选里选过）：直接用它。
  const explicit = readWorkspaceRoot(input)
  if (explicit !== undefined) return { ok: true, params: input }

  const resolution = await deps.workspace.resolve()
  if (resolution.status === 'resolved') {
    const base = isRecord(input) ? input : {}
    return { ok: true, params: { ...base, workspaceRoot: resolution.root } }
  }

  // 命中不了：把候选推给面板，让用户选一个工作区。
  postWorkspaceCandidates(orca, resolution.candidates)
  deps.log('warn', LOG_EVENTS.snapshot, {
    result: 'error',
    reason: resolution.status,
    candidates: resolution.candidates.length,
  })
  return {
    ok: false,
    result: {
      ok: false,
      error: {
        code: ERROR_CODES.invalidParams,
        message: '无法确定当前工作区，请在面板里选择一个工作区后重试。',
      },
    },
  }
}

/**
 * 推给面板的候选形状。
 *
 * 分支在面板侧是字符串：没有分支的工作区（普通文件夹）传空串，
 * 面板按「无分支」渲染，不会把这类候选丢掉。
 */
interface PanelWorkspaceCandidate {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly branch: string
  readonly project: string
  readonly kind: string
}

/**
 * 把候选工作区推给面板。
 * @param orca - worker API。
 * @param candidates - 候选列表。
 */
export function postWorkspaceCandidates(
  orca: OrcaWorkerApi,
  candidates: readonly WorkspaceCandidate[],
): void {
  const payload: readonly PanelWorkspaceCandidate[] = candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    path: candidate.path,
    branch: candidate.branch ?? '',
    project: candidate.project ?? '',
    kind: candidate.kind,
  }))
  orca.panels.post(WORKSPACE_CANDIDATES_EVENT, { candidates: payload })
}

/**
 * 注册「安装入池技能」处理器。
 *
 * 这是往用户机器上写文件的动作，只在面板显式调用时执行。
 * @param orca - worker API。
 */
export function registerSkillInstallHandler(orca: OrcaWorkerApi): void {
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
}
