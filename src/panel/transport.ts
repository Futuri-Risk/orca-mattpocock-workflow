/**
 * 面板到 worker 的传输层。原来走插件私有 HTTP 路由，现在走 Orca 的
 * `orca.plugin.request`：worker 用 `orca.panels.handle(name)` 注册同名 handler，
 * 面板按 `protocol/tracker.ts` 里的方法名调用，参数与返回形状不变。
 *
 * worker 抛错时请求会 reject，这里把它折成一条 `fetch-failed`，
 * 界面仍按错误码给提示。
 */
import type { EnvCheckReport } from '../protocol/env-check.ts'
import {
  SKILL_COMMAND_METHOD,
  SKILL_COMMAND_SOURCES,
  SKILL_COMMAND_STYLES,
  type SkillCommandResolution,
  type SkillCommandStyle,
} from '../protocol/skill-command.ts'
import { activeTranslate, type Translate } from './i18n.ts'
import { readFrame } from './host.ts'
import {
  TICKET_ACTION_REASONS,
  TICKET_SKILL_ACTIONS,
  type TicketActionReason,
  type TicketSkillAction,
} from '../protocol/labels.ts'
import {
  AVATAR_READ_METHOD,
  ERROR_CODES,
  RPC_METHODS,
  type AvatarReadParams,
  type AvatarReadResult,
  type ErrorCode,
  type RpcErrorBody,
  type RpcResult,
  SNAPSHOT_CLEAR_CONFIRMATION,
  type SnapshotCacheInfo,
  type SnapshotCacheParams,
  type SnapshotRefreshParams,
  TICKET_DELETE_CONFIRMATION,
  type TicketAuthor,
  type TicketComment,
  type TicketDeleteResult,
  type TicketDetail,
  type TicketOptions,
  type TicketPatch,
  type TicketUpdateResult,
  type TicketWorktreeResult,
  type WorkspaceSnapshot,
} from '../protocol/tracker.ts'

/** 一次插件请求：方法名与入参原样透传给 worker 的 handler。 */
export type RequestLike = (name: string, input: unknown) => Promise<unknown>

/** 面板客户端：界面只依赖这些方法。 */
export interface PanelClient {
  get(workspaceRoot: string): Promise<RpcResult<WorkspaceSnapshot>>
  /**
   * 刷新快照。默认走增量；`full` 为 true 时忽略本地快照库，全量重拉一次。
   */
  refresh(
    workspaceRoot: string,
    options?: { readonly full?: boolean },
  ): Promise<RpcResult<WorkspaceSnapshot>>
  /**
   * 按快照给出的游标取下一段工单，追加到已加载的列表。
   * 没有更多时原样返回当前快照。
   */
  loadMore(workspaceRoot: string): Promise<RpcResult<WorkspaceSnapshot>>
  /**
   * 读取本地快照库的信息；`clear` 为 true 时按确认词清空它。
   */
  cache(
    workspaceRoot: string,
    options?: { readonly clear?: boolean },
  ): Promise<RpcResult<SnapshotCacheInfo>>
  /** 补齐原生阻塞信息；快照已定稿时 worker 直接返回缓存。 */
  resolveBlockers(workspaceRoot: string): Promise<RpcResult<WorkspaceSnapshot>>
  /** 重新跑一次环境检查；worker 不缓存结果。 */
  envCheck(workspaceRoot: string): Promise<RpcResult<EnvCheckReport>>
  /** 读取单张工单详情；打开详情时按需请求，不进入列表快照。 */
  getDetail(
    workspaceRoot: string,
    ref: string,
    number: number | null,
  ): Promise<RpcResult<TicketDetail>>
  /** 提交一次变更；成功后由调用方重新读取详情。 */
  updateTicket(
    workspaceRoot: string,
    ref: string,
    number: number | null,
    patch: TicketPatch,
  ): Promise<RpcResult<TicketUpdateResult>>
  /** 读取仓库的标签与可分配用户，供补全使用；不支持时返回 capability-unsupported。 */
  getOptions(workspaceRoot: string): Promise<RpcResult<TicketOptions>>
  /** 永久删除一张工单；确认词由界面在用户输入后传入。 */
  deleteTicket(
    workspaceRoot: string,
    ref: string,
    number: number | null,
  ): Promise<RpcResult<TicketDeleteResult>>
  /**
   * 为一张远端工单创建 Orca 托管的 worktree；同分支已存在时返回既有工作区，
   * `created` 为 false。
   */
  createWorktree(
    workspaceRoot: string,
    ref: string,
    number: number | null,
  ): Promise<RpcResult<TicketWorktreeResult>>
  /**
   * 读取 worker 当前认领的工作区与候选。面板启动与 `workspace.changed` 后用它同步：
   * 候选不依赖推送是否被去重，面板重载也不会丢掉选择区。
   */
  currentWorkspace(): Promise<RpcResult<WorkspaceClaim>>
  /**
   * 把远端头像读成 data URL。面板 frame 的 CSP 不放行远端图片，
   * 由 worker 下载后转成 `data:image/…`，界面才加载得出来。
   */
  readAvatar(url: string): Promise<RpcResult<AvatarReadResult>>
  /**
   * 读取当前生效的技能命令写法。复制手势前问一次，
   * 复制出去的命令要和用户当前客户端一致（`/技能名`、`/skill:技能名` 或 `$技能名`）。
   */
  skillCommand(): Promise<RpcResult<SkillCommandResolution>>
}

/** worker 当前认领的工作区；认领不到时带上候选。 */
export interface WorkspaceClaim {
  readonly root: string | null
  readonly contextKey: string
  readonly candidates: readonly WorkspaceCandidate[]
}

/** 读取当前认领结果的方法名。不在协议方法表里，是插件自己的额外处理器。 */
export const WORKSPACE_CURRENT_METHOD = 'workspace.current'

/**
 * 安装入池技能的方法名。不在协议的方法表里，是插件自己的额外处理器：
 * 用户在环境检查里点「安装技能」时才调用。
 */
export const SKILLS_INSTALL_METHOD = 'skills.install'

/** 一次技能安装的结果。 */
export interface SkillsInstallResult {
  /** 宿主扫描的技能目录。 */
  readonly targets: readonly string[]
  /** 装成功的技能。 */
  readonly installed: readonly { readonly skill: string; readonly directory: string }[]
  /** 装失败的技能与原因。 */
  readonly failed: readonly {
    readonly skill: string
    readonly directory: string
    readonly reason: string
  }[]
}

/** worker 推送的工作区候选：认领不到当前工作区时让用户选一个。 */
export interface WorkspaceCandidate {
  readonly id: string
  readonly name: string
  /** 绝对路径；选中后作为 `workspaceRoot` 传给 worker。 */
  readonly path: string
  readonly branch: string
  /** 所属仓库名；工作区别名重名时靠它区分。 */
  readonly project: string
  readonly kind: string
}

/**
 * 创建走 Orca 插件桥的客户端。
 * @param request - 请求实现，默认用 `orca.plugin.request`。
 * @returns 面板客户端。
 */
export function createPanelClient(request: RequestLike = defaultRequest): PanelClient {
  return {
    get: (workspaceRoot) =>
      call(request, RPC_METHODS.snapshotGet, { workspaceRoot }, isSnapshotResult),
    refresh: (workspaceRoot, options) => {
      // 只有明确要求全量时才带上 full：缺省时 worker 能用增量就用增量。
      const params: SnapshotRefreshParams =
        options?.full === true ? { workspaceRoot, full: true } : { workspaceRoot }
      return call(request, RPC_METHODS.snapshotRefresh, params, isSnapshotResult)
    },
    loadMore: (workspaceRoot) =>
      call(request, RPC_METHODS.snapshotLoadMore, { workspaceRoot }, isSnapshotResult),
    cache: (workspaceRoot, options) => {
      const params: SnapshotCacheParams =
        options?.clear === true
          ? { workspaceRoot, clear: true, confirm: SNAPSHOT_CLEAR_CONFIRMATION }
          : { workspaceRoot }
      return call(request, RPC_METHODS.snapshotCache, params, isSnapshotCacheResult)
    },
    resolveBlockers: (workspaceRoot) =>
      call(request, RPC_METHODS.snapshotResolveBlockers, { workspaceRoot }, isSnapshotResult),
    envCheck: (workspaceRoot) =>
      call(request, RPC_METHODS.envCheck, { workspaceRoot }, isEnvCheckResult),
    getDetail: (workspaceRoot, ref, number) =>
      call(request, RPC_METHODS.ticketGet, { workspaceRoot, ref, number }, isTicketDetailResult),
    updateTicket: (workspaceRoot, ref, number, patch) =>
      call(
        request,
        RPC_METHODS.ticketUpdate,
        { workspaceRoot, ref, number, patch },
        isTicketUpdateResult,
      ),
    getOptions: (workspaceRoot) =>
      call(request, RPC_METHODS.ticketOptions, { workspaceRoot }, isTicketOptionsResult),
    deleteTicket: (workspaceRoot, ref, number) =>
      call(
        request,
        RPC_METHODS.ticketDelete,
        { workspaceRoot, ref, number, confirm: TICKET_DELETE_CONFIRMATION },
        isTicketDeleteResult,
      ),
    createWorktree: (workspaceRoot, ref, number) =>
      call(
        request,
        RPC_METHODS.ticketWorktree,
        { workspaceRoot, ref, number },
        isTicketWorktreeResult,
      ),
    currentWorkspace: () =>
      call(request, WORKSPACE_CURRENT_METHOD, {}, isWorkspaceClaimResult),
    readAvatar: (url) => {
      const params: AvatarReadParams = { url }
      return call(request, AVATAR_READ_METHOD, params, isAvatarReadResult)
    },
    skillCommand: () => call(request, SKILL_COMMAND_METHOD, {}, isSkillCommandResolutionResult),
  }
}

/**
 * 让 worker 把入池技能装到宿主的技能目录。
 * @param request - 请求实现，默认用 `orca.plugin.request`。
 * @returns 安装结果；worker 不可用时是一条失败结果。
 */
export function installSkills(
  request: RequestLike = defaultRequest,
): Promise<RpcResult<SkillsInstallResult>> {
  return call(request, SKILLS_INSTALL_METHOD, {}, isSkillsInstallResult)
}

/**
 * 请求的截止时间。worker 侧会跑 gh / glab 这类命令行，可能超过默认的 30 秒。
 */
const REQUEST_TIMEOUT_MS = 120_000

/** 默认请求实现：走 Orca 注入的插件桥。 */
function defaultRequest(name: string, input: unknown): Promise<unknown> {
  const bridge = readFrame()?.plugin
  if (bridge === undefined || typeof bridge.request !== 'function') {
    return Promise.reject(new Error(activeTranslate()('error.bridgeUnavailable')))
  }
  return bridge.request(name, input, { timeoutMs: REQUEST_TIMEOUT_MS })
}

async function call<T>(
  request: RequestLike,
  method: string,
  params: unknown,
  isResult: (value: unknown) => value is RpcResult<T>,
): Promise<RpcResult<T>> {
  try {
    const body = await request(method, params)
    if (!isResult(body)) {
      return failure(ERROR_CODES.fetchFailed, activeTranslate()('error.badResponse'))
    }
    return body
  } catch (error) {
    return failure(ERROR_CODES.fetchFailed, requestFailureMessage(error, activeTranslate()))
  }
}

/** 请求失败时的说明：带上宿主给的错误码，用户能分辨是超时还是方法没注册。 */
function requestFailureMessage(error: unknown, t: Translate): string {
  if (!(error instanceof Error)) return t('error.requestFailedUnknown')
  const code = 'code' in error && typeof error.code === 'string' ? error.code : null
  const suffix = code === null ? '' : t('error.requestCodeSuffix', { code })
  return t('error.requestFailed', { message: error.message, suffix })
}

function failure<T>(code: ErrorCode, message: string): RpcResult<T> {
  return { ok: false, error: { code, message } }
}

function isRpcResult<T>(
  value: unknown,
  isPayload: (payload: unknown) => payload is T,
): value is RpcResult<T> {
  if (typeof value !== 'object' || value === null) return false
  if (!('ok' in value)) return false

  if (value.ok === false) {
    if (!('error' in value)) return false
    const error = value.error
    if (typeof error !== 'object' || error === null) return false
    return 'code' in error && typeof error.code === 'string' && 'message' in error
  }

  if (value.ok !== true) return false
  if (!('result' in value)) return false
  return isPayload(value.result)
}

function isSnapshotResult(value: unknown): value is RpcResult<WorkspaceSnapshot> {
  return isRpcResult(value, isWorkspaceSnapshot)
}

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  if (typeof value !== 'object' || value === null) return false
  if (!('backend' in value) || typeof value.backend !== 'string') return false
  if (!('repository' in value) || typeof value.repository !== 'string') return false
  if (!('repositoryHost' in value)) return false
  if (value.repositoryHost !== null && typeof value.repositoryHost !== 'string') return false
  if (!('fetchedAt' in value) || typeof value.fetchedAt !== 'number') return false
  if (!('loaded' in value) || typeof value.loaded !== 'number') return false
  if (!('total' in value) || typeof value.total !== 'number') return false
  if (!('hasMore' in value) || typeof value.hasMore !== 'boolean') return false
  if (!('tickets' in value) || !Array.isArray(value.tickets)) return false
  if (!value.tickets.every(hasTicketFields)) return false
  // 当前用户与分配人决定人员筛选能否成立：缺字段按版本错配处理，不静默降级。
  if (!('viewer' in value)) return false
  if (value.viewer !== null && (typeof value.viewer !== 'string' || value.viewer.length === 0)) {
    return false
  }
  if (!('metrics' in value) || typeof value.metrics !== 'object' || value.metrics === null) {
    return false
  }
  if (!('blockersFinalized' in value) || typeof value.blockersFinalized !== 'boolean') return false
  // 数据来源、是否陈旧与刷新失败原因：少一个字段就无法如实呈现数据的新鲜度。
  if (!('source' in value) || !(value.source === 'live' || value.source === 'cache')) return false
  if (!('stale' in value) || typeof value.stale !== 'boolean') return false
  if (!('refreshError' in value)) return false
  if (value.refreshError !== null && !isRpcErrorBody(value.refreshError)) return false
  return true
}

/** 一次候选事件：候选与它所属的聚焦上下文键。 */
export interface WorkspaceCandidatesEvent {
  readonly contextKey: string
  readonly candidates: readonly WorkspaceCandidate[]
}

/**
 * 解析 worker 推送的工作区候选。推送内容不可信，逐个字段核对。
 * @param payload - 事件的载荷。
 * @returns 上下文键与能认出来的候选；没有候选时是空数组。
 */
export function parseWorkspaceCandidatesEvent(payload: unknown): WorkspaceCandidatesEvent {
  if (typeof payload !== 'object' || payload === null) {
    return { contextKey: '', candidates: [] }
  }
  const contextKey =
    'contextKey' in payload && typeof payload.contextKey === 'string' ? payload.contextKey : ''
  const candidates =
    'candidates' in payload && Array.isArray(payload.candidates)
      ? payload.candidates.filter(isWorkspaceCandidate)
      : []
  return { contextKey, candidates }
}

function isWorkspaceCandidate(value: unknown): value is WorkspaceCandidate {
  if (typeof value !== 'object' || value === null) return false
  if (!('id' in value) || typeof value.id !== 'string') return false
  if (!('name' in value) || typeof value.name !== 'string') return false
  if (!('path' in value) || typeof value.path !== 'string') return false
  if (!('branch' in value) || typeof value.branch !== 'string') return false
  if (!('project' in value) || typeof value.project !== 'string') return false
  if (!('kind' in value) || typeof value.kind !== 'string') return false
  return true
}

function isWorkspaceClaimResult(value: unknown): value is RpcResult<WorkspaceClaim> {
  return isRpcResult(value, isWorkspaceClaim)
}

function isWorkspaceClaim(value: unknown): value is WorkspaceClaim {
  if (typeof value !== 'object' || value === null) return false
  if (!('root' in value) || !(value.root === null || typeof value.root === 'string')) return false
  if (!('contextKey' in value) || typeof value.contextKey !== 'string') return false
  if (!('candidates' in value) || !Array.isArray(value.candidates)) return false
  return value.candidates.every(isWorkspaceCandidate)
}

/** 失败响应体：错误码与说明都要有，缺一个就当作格式不对。 */
function isRpcErrorBody(value: unknown): value is RpcErrorBody {
  if (typeof value !== 'object' || value === null) return false
  if (!('code' in value) || typeof value.code !== 'string') return false
  if (!('message' in value) || typeof value.message !== 'string') return false
  return true
}

function isSnapshotCacheResult(value: unknown): value is RpcResult<SnapshotCacheInfo> {
  return isRpcResult(value, isSnapshotCacheInfo)
}

function isSnapshotCacheInfo(value: unknown): value is SnapshotCacheInfo {
  if (typeof value !== 'object' || value === null) return false
  if (!('location' in value) || typeof value.location !== 'string') return false
  if (!('entries' in value) || typeof value.entries !== 'number') return false
  if (!('lastWrittenAt' in value)) return false
  if (value.lastWrittenAt !== null && typeof value.lastWrittenAt !== 'number') return false
  if (!('cleared' in value) || typeof value.cleared !== 'number') return false
  return true
}

function hasTicketFields(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  if (!('skillAction' in value) || !isSkillAction(value.skillAction)) return false
  if (!('skillActionReason' in value) || !isActionReason(value.skillActionReason)) return false
  if (!('assignees' in value) || !Array.isArray(value.assignees)) return false
  // 链接是可选字段：旧 worker 不给也能用，但给了就必须是非空字符串。
  if ('url' in value && (typeof value.url !== 'string' || value.url.length === 0)) return false
  return value.assignees.every((login) => typeof login === 'string' && login.length > 0)
}

function isSkillAction(value: unknown): value is TicketSkillAction {
  return TICKET_SKILL_ACTIONS.some((action) => action === value)
}

function isActionReason(value: unknown): value is TicketActionReason {
  return TICKET_ACTION_REASONS.some((reason) => reason === value)
}

function isEnvCheckResult(value: unknown): value is RpcResult<EnvCheckReport> {
  return isRpcResult(value, isEnvCheckReport)
}

function isEnvCheckReport(value: unknown): value is EnvCheckReport {
  if (typeof value !== 'object' || value === null) return false
  if (!('checkedAt' in value) || typeof value.checkedAt !== 'number') return false
  if (!('backend' in value) || !(value.backend === null || typeof value.backend === 'string')) {
    return false
  }
  if (!('repository' in value)) return false
  if (value.repository !== null && typeof value.repository !== 'string') return false
  if (!('items' in value) || !Array.isArray(value.items)) return false
  if (!('capabilities' in value) || !Array.isArray(value.capabilities)) return false
  return true
}

function isTicketDetailResult(value: unknown): value is RpcResult<TicketDetail> {
  return isRpcResult(value, isTicketDetail)
}

/** 头像响应只接受 worker 生成的图片 data URL，别的 data: 类型不进 `img`。 */
function isAvatarReadResult(value: unknown): value is RpcResult<AvatarReadResult> {
  return isRpcResult(
    value,
    (payload): payload is AvatarReadResult =>
      isObject(payload) &&
      typeof payload.dataUrl === 'string' &&
      payload.dataUrl.startsWith('data:image/'),
  )
}

function isTicketDetail(value: unknown): value is TicketDetail {
  if (typeof value !== 'object' || value === null) return false
  if (!('ref' in value) || typeof value.ref !== 'string') return false
  if (!('number' in value) || !(value.number === null || typeof value.number === 'number')) {
    return false
  }
  if (!('title' in value) || typeof value.title !== 'string') return false
  if (!('state' in value) || !(value.state === 'open' || value.state === 'closed')) return false
  if (!('author' in value) || !(value.author === null || isTicketAuthor(value.author))) {
    return false
  }
  if (!('body' in value) || typeof value.body !== 'string') return false
  if (!('labels' in value) || !Array.isArray(value.labels)) return false
  if (
    !('assignees' in value) ||
    !Array.isArray(value.assignees) ||
    !value.assignees.every(isTicketAuthor)
  ) {
    return false
  }
  if (
    !('comments' in value) ||
    !Array.isArray(value.comments) ||
    !value.comments.every(isTicketComment)
  ) {
    return false
  }
  if (!('url' in value) || !(value.url === null || typeof value.url === 'string')) return false
  if (!('createdAt' in value) || typeof value.createdAt !== 'string') return false
  if (!('updatedAt' in value) || typeof value.updatedAt !== 'string') return false
  if (!('backend' in value) || typeof value.backend !== 'string') return false
  if (!('capabilities' in value) || typeof value.capabilities !== 'object') return false
  if (value.capabilities === null) return false
  return hasCapabilityFlags(value.capabilities)
}

/** 远端用户：登录名必填，展示名与头像地址可以为 null。 */
function isTicketAuthor(value: unknown): value is TicketAuthor {
  if (!isObject(value)) return false
  if (typeof value.login !== 'string' || value.login.length === 0) return false
  if (!('displayName' in value)) return false
  if (value.displayName !== null && typeof value.displayName !== 'string') return false
  if (!('avatarUrl' in value)) return false
  return value.avatarUrl === null || typeof value.avatarUrl === 'string'
}

/** 一条评论：作者可以是 null（本地 Markdown），时间也可以是 null。 */
function isTicketComment(value: unknown): value is TicketComment {
  if (!isObject(value)) return false
  if (!('author' in value) || !(value.author === null || isTicketAuthor(value.author))) {
    return false
  }
  if (!('body' in value) || typeof value.body !== 'string') return false
  if (!('createdAt' in value)) return false
  return value.createdAt === null || typeof value.createdAt === 'string'
}

/** 详情的能力位：五个开关都要是布尔值。 */
function hasCapabilityFlags(value: object): boolean {
  const flags = new Map(Object.entries(value))
  return (['labels', 'assignees', 'state', 'link', 'delete'] as const).every(
    (key) => typeof flags.get(key) === 'boolean',
  )
}

function isTicketUpdateResult(value: unknown): value is RpcResult<TicketUpdateResult> {
  return isRpcResult(
    value,
    (payload): payload is TicketUpdateResult =>
      typeof payload === 'object' &&
      payload !== null &&
      'applied' in payload &&
      payload.applied === true,
  )
}

function isTicketWorktreeResult(value: unknown): value is RpcResult<TicketWorktreeResult> {
  return isRpcResult(value, isTicketWorktree)
}

function isTicketWorktree(value: unknown): value is TicketWorktreeResult {
  if (typeof value !== 'object' || value === null) return false
  if (!('id' in value) || typeof value.id !== 'string') return false
  if (!('path' in value) || typeof value.path !== 'string') return false
  if (!('branch' in value) || typeof value.branch !== 'string') return false
  if (!('name' in value) || typeof value.name !== 'string') return false
  if (!('reference' in value) || typeof value.reference !== 'string') return false
  if (!('created' in value) || typeof value.created !== 'boolean') return false
  return true
}

function isTicketDeleteResult(value: unknown): value is RpcResult<TicketDeleteResult> {
  return isRpcResult(
    value,
    (payload): payload is TicketDeleteResult =>
      typeof payload === 'object' &&
      payload !== null &&
      'deleted' in payload &&
      payload.deleted === true,
  )
}

function isTicketOptionsResult(value: unknown): value is RpcResult<TicketOptions> {
  return isRpcResult(value, isTicketOptions)
}

function isTicketOptions(value: unknown): value is TicketOptions {
  if (typeof value !== 'object' || value === null) return false
  if (!('labels' in value) || !Array.isArray(value.labels)) return false
  if (!('assignees' in value) || !Array.isArray(value.assignees)) return false
  const labelsValid = value.labels.every(
    (label: unknown) =>
      isObject(label) &&
      typeof label.name === 'string' &&
      (label.color === null || typeof label.color === 'string') &&
      (label.description === null || typeof label.description === 'string'),
  )
  const assigneesValid = value.assignees.every(
    (user: unknown) =>
      isObject(user) &&
      typeof user.username === 'string' &&
      (user.name === null || typeof user.name === 'string'),
  )
  return labelsValid && assigneesValid
}

function isSkillsInstallResult(value: unknown): value is RpcResult<SkillsInstallResult> {
  return isRpcResult(value, isSkillsInstallResultPayload)
}

function isSkillsInstallResultPayload(value: unknown): value is SkillsInstallResult {
  if (typeof value !== 'object' || value === null) return false
  if (!('targets' in value) || !Array.isArray(value.targets)) return false
  if (!('installed' in value) || !Array.isArray(value.installed)) return false
  if (!('failed' in value) || !Array.isArray(value.failed)) return false
  return true
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSkillCommandResolutionResult(
  value: unknown,
): value is RpcResult<SkillCommandResolution> {
  return isRpcResult(value, isSkillCommandResolution)
}

/** 写法结果：写法与来源都必须是已知值，别的形状当作没解析出来。 */
function isSkillCommandResolution(value: unknown): value is SkillCommandResolution {
  return (
    isObject(value) &&
    isSkillCommandStyle(value['style']) &&
    isSkillCommandSource(value['source'])
  )
}

function isSkillCommandStyle(value: unknown): value is SkillCommandStyle {
  return SKILL_COMMAND_STYLES.some((style) => style === value)
}

function isSkillCommandSource(value: unknown): value is SkillCommandResolution['source'] {
  return SKILL_COMMAND_SOURCES.some((source) => source === value)
}