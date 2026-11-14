/**
 * 工单 worktree 服务：读工单详情拿真实链接，按仓库约定推导分支，
 * 再通过 Orca 命令行创建 Orca 托管的 worktree。
 *
 * 与工单服务并列，沿用 `handle(method, params)` 接缝。幂等判断放在建之前：
 * 先列当前仓库的 worktree，同分支已存在就返回它并标记「已存在」，
 * 不再调用创建命令。
 */
import { categorize } from '../core/classify.ts'
import { isRecord } from '../core/json.ts'
import type { CommandRunner, TicketReference } from '../core/ticket.ts'
import { CommandError, TrackerError, commandFailureDetail } from '../core/tracker-error.ts'
import {
  WORKTREE_CREATE_TIMEOUT_MS,
  type CurrentWorktree,
  type WorktreeRecord,
  findWorktreeByBranch,
  normalizeBranch,
  parseWorktreeCreateOutput,
  parseWorktreeCurrentOutput,
  parseWorktreeListOutput,
  planWorktree,
  worktreeCreateArgs,
  worktreeCurrentArgs,
  worktreeListArgs,
} from '../core/worktree.ts'
import { BACKEND_LABELS, type BackendKind } from '../protocol/backend.ts'
import { TRACKER_LABELS } from '../protocol/labels.ts'
import { LOG_EVENTS, TICKET_ACTIONS } from '../protocol/log-events.ts'
import {
  ERROR_CODES,
  RPC_METHODS,
  type ErrorCode,
  type RpcResult,
  type TicketWorktreeResult,
} from '../protocol/tracker.ts'
import type { BackendResolver } from './backend-resolver.ts'
import type { LogSink } from './log.ts'
import type { OrcaCli } from './orca-cli.ts'
import { resolveOrcaCli } from './orca-cli.ts'
import { readTicketParams, type TicketParams } from './rpc-params.ts'

/** worktree 服务依赖。 */
export interface TicketWorktreeServiceDeps {
  /** 按工作区解析后端；解析结果由宿主自己缓存。 */
  readonly resolve: BackendResolver
  /** 命令执行器；Orca 命令行与 git 命令共用。 */
  readonly run: CommandRunner
  readonly now: () => number
  readonly log: LogSink
  /** Orca 命令行候选；测试注入固定候选，正式代码按环境推导。 */
  readonly candidates?: (() => readonly string[]) | undefined
}

/** 宿主对界面的 worktree RPC 入口。 */
export interface TicketWorktreeService {
  /**
   * 处理一个 worktree 方法。
   * @param method - 只支持 `ticket.worktree`。
   * @param params - 工作区与工单定位参数。
   * @returns 新建或既有的 worktree，或带错误码的失败。
   */
  handle(method: string, params: unknown): Promise<RpcResult<TicketWorktreeResult>>
}

/**
 * 创建工单 worktree 服务。
 * @param deps - 后端解析器、命令执行器、时钟与日志出口。
 * @returns worktree 服务。
 */
export function createTicketWorktreeService(
  deps: TicketWorktreeServiceDeps,
): TicketWorktreeService {
  return {
    handle(method, params) {
      if (method !== RPC_METHODS.ticketWorktree) {
        return Promise.resolve(failure(ERROR_CODES.unknownMethod, `未知方法：${method}`))
      }
      return createWorktree(deps, params)
    },
  }
}

async function createWorktree(
  deps: TicketWorktreeServiceDeps,
  params: unknown,
): Promise<RpcResult<TicketWorktreeResult>> {
  const target = readTicketParams(params)
  if (target === undefined) {
    return failure(ERROR_CODES.invalidParams, '缺少 workspaceRoot、ref 或 number 参数。')
  }

  const startedAt = deps.now()
  let kind: BackendKind | undefined
  try {
    const resolved = await deps.resolve(target.workspaceRoot)
    kind = resolved.kind
    const fetchDetail = resolved.tracker.fetchDetail
    if (kind === 'markdown' || fetchDetail === undefined) {
      return unsupported(kind, '为工单创建 worktree')
    }

    const detail = await fetchDetail(target.workspaceRoot, referenceOf(target))
    if (detail.url === null) {
      return failure(
        ERROR_CODES.capabilityUnsupported,
        `工单没有远端链接，无法挂到 worktree（${BACKEND_LABELS[kind]}）。`,
      )
    }
    if (detail.number === null) {
      return failure(ERROR_CODES.capabilityUnsupported, '工单没有编号，无法推导分支名。')
    }

    const cli = await resolveOrcaCli(deps.run, {
      ...(deps.candidates === undefined ? {} : { candidates: deps.candidates() }),
      cwd: target.workspaceRoot,
    })
    if (cli === undefined) {
      const code = ERROR_CODES.orcaMissing
      logResult(deps, 'warn', kind, 'worktree', startedAt, code)
      return failure(
        code,
        '未找到 Orca 命令行，请先安装 Orca 或在环境检查里设置 ORCA_CLI_COMMAND。',
      )
    }

    const plan = planWorktree({
      number: detail.number,
      title: detail.title,
      category: categorize(detail.labels, TRACKER_LABELS),
      reference: detail.url,
    })

    const current = await readCurrentWorktree(deps, cli, target.workspaceRoot)
    if (current === undefined) {
      const code = ERROR_CODES.worktreeCreateFailed
      logResult(deps, 'warn', kind, 'worktree', startedAt, code)
      return failure(code, '无法识别当前工作区所属的仓库，Orca 没有返回仓库 id。')
    }

    const existing = await listExisting(deps, cli, target.workspaceRoot, current.repoId, plan.branch)
    if (existing !== undefined) {
      logResult(deps, 'info', kind, 'worktree', startedAt)
      return { ok: true, result: worktreeResultOf(existing, detail.url, plan.name, false) }
    }

    const output = await deps.run(cli.command, worktreeCreateArgs(plan), {
      cwd: target.workspaceRoot,
      timeoutMs: WORKTREE_CREATE_TIMEOUT_MS,
    })
    const created = parseWorktreeCreateOutput(output.stdout)
    if (created === undefined) {
      const code = ERROR_CODES.worktreeCreateFailed
      logResult(deps, 'warn', kind, 'worktree', startedAt, code)
      return failure(code, 'Orca 返回的 worktree 创建结果格式不正确。')
    }

    logResult(deps, 'info', kind, 'worktree', startedAt)
    return { ok: true, result: worktreeResultOf(created, detail.url, plan.name, true) }
  } catch (error) {
    const mapped = mapError(error)
    logResult(deps, 'warn', kind, 'worktree', startedAt, mapped.code)
    return failure(mapped.code, mapped.message)
  }
}

/**
 * 按当前目录读出工作区与它所属的仓库 id。
 *
 * `worktree list --repo path:<工作区>` 只认仓库根目录，不认 worktree 路径；
 * 所以先问 Orca「当前目录是哪个工作区」，再用它给出的仓库 id 列同一仓库的 worktree。
 * @param deps - 服务依赖。
 * @param cli - 已确认的 Orca 命令行。
 * @param workspaceRoot - 工作区根目录。
 * @returns 当前工作区；无法识别时是 undefined。
 */
async function readCurrentWorktree(
  deps: TicketWorktreeServiceDeps,
  cli: OrcaCli,
  workspaceRoot: string,
): Promise<CurrentWorktree | undefined> {
  const output = await deps.run(cli.command, worktreeCurrentArgs(), {
    cwd: workspaceRoot,
    timeoutMs: WORKTREE_CREATE_TIMEOUT_MS,
  })
  return parseWorktreeCurrentOutput(output.stdout)
}

/**
 * 列同一仓库的 worktree 并找同分支记录。
 * @param deps - 服务依赖。
 * @param cli - 已确认的 Orca 命令行。
 * @param workspaceRoot - 工作区根目录。
 * @param repoId - 当前工作区所属的仓库 id。
 * @param branch - 目标分支名。
 * @returns 既有记录；没有时是 undefined。
 */
async function listExisting(
  deps: TicketWorktreeServiceDeps,
  cli: OrcaCli,
  workspaceRoot: string,
  repoId: string,
  branch: string,
): Promise<WorktreeRecord | undefined> {
  const output = await deps.run(cli.command, worktreeListArgs(repoId), {
    cwd: workspaceRoot,
    timeoutMs: WORKTREE_CREATE_TIMEOUT_MS,
  })
  const records = parseWorktreeListOutput(output.stdout)
  if (records === undefined) {
    throw new OrcaOutputError('无法解析 Orca 的 worktree 列表输出。')
  }
  return findWorktreeByBranch(records, branch)
}

/**
 * 把 Orca 记录整理成协议结果。显示名缺失时退回标题，分支去掉 `refs/heads/`。
 * @param record - Orca 返回的 worktree。
 * @param reference - 后端详情里的工单链接。
 * @param fallbackName - 显示名缺失时的标题。
 * @param created - 本次是否新建。
 * @returns 协议结果。
 */
function worktreeResultOf(
  record: WorktreeRecord,
  reference: string,
  fallbackName: string,
  created: boolean,
): TicketWorktreeResult {
  return {
    id: record.id,
    path: record.path,
    branch: normalizeBranch(record.branch),
    name: record.displayName.length > 0 ? record.displayName : fallbackName,
    reference,
    created,
  }
}

/**
 * 命令行的可操作诊断。带 `--json` 的 Orca 把错误信封写在标准输出上；
 * 优先从那里读出错误码与消息，其次才是标准错误的一行。
 * @param error - 命令执行失败。
 * @returns 截断后的诊断。
 */
function commandDiagnostic(error: CommandError): string {
  const parsed = parseErrorEnvelope(error.stdout)
  if (parsed !== undefined) return parsed
  return commandFailureDetail(error)
}

function parseErrorEnvelope(stdout: string): string | undefined {
  try {
    const value: unknown = JSON.parse(stdout)
    if (!isRecord(value) || !isRecord(value['error'])) return undefined
    const error = value['error']
    const code = typeof error['code'] === 'string' ? error['code'] : null
    const message = typeof error['message'] === 'string' ? error['message'] : null
    if (message === null) return undefined
    const text = code === null ? message : `${code}: ${message}`
    return text.length > 200 ? `${text.slice(0, 200)}…` : text
  } catch {
    return undefined
  }
}

/** 输出形状不符合预期；由外层映射成创建失败。 */
class OrcaOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrcaOutputError'
  }
}

function referenceOf(target: TicketParams): TicketReference {
  return { ref: target.ref, number: target.number }
}

function unsupported<T>(kind: BackendKind, action: string): RpcResult<T> {
  if (kind === 'markdown') {
    return failure(
      ERROR_CODES.capabilityUnsupported,
      '本地工单没有远端链接，无法挂到 worktree。',
    )
  }
  return failure(
    ERROR_CODES.capabilityUnsupported,
    `当前后端（${BACKEND_LABELS[kind]}）不支持${action}。`,
  )
}

function mapError(error: unknown): { readonly code: ErrorCode; readonly message: string } {
  if (error instanceof TrackerError) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof CommandError) {
    if (error.kind === 'not-found') {
      return {
        code: ERROR_CODES.orcaMissing,
        message: '未找到 Orca 命令行，请先安装 Orca 或在环境检查里设置 ORCA_CLI_COMMAND。',
      }
    }
    const detail = commandDiagnostic(error)
    const prefix = error.kind === 'timeout' ? '创建 worktree 超时' : '创建 worktree 失败'
    return {
      code: ERROR_CODES.worktreeCreateFailed,
      message: detail.length === 0 ? `${prefix}。` : `${prefix}：${detail}`,
    }
  }
  if (error instanceof OrcaOutputError) {
    return { code: ERROR_CODES.worktreeCreateFailed, message: error.message }
  }
  return { code: ERROR_CODES.internal, message: '创建 worktree 时发生未预期的错误。' }
}

function logResult(
  deps: TicketWorktreeServiceDeps,
  level: 'info' | 'warn',
  kind: BackendKind | undefined,
  action: keyof typeof TICKET_ACTIONS,
  startedAt: number,
  code?: ErrorCode,
): void {
  deps.log(level, LOG_EVENTS.ticket, {
    result: code === undefined ? 'ok' : 'error',
    action: TICKET_ACTIONS[action],
    ...(kind === undefined ? {} : { backend: kind }),
    ...(code === undefined ? {} : { code }),
    durationMs: Math.max(0, deps.now() - startedAt),
  })
}

function failure<T>(code: ErrorCode, message: string): RpcResult<T> {
  return { ok: false, error: { code, message } }
}
