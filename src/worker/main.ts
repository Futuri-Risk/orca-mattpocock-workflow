/**
 * Orca worker 入口。
 *
 * 这里只做组装：工单规则在 core，各后端读取在 adapters，RPC 契约在 protocol，
 * 面板处理器、命令与技能安装都注册在这一层。
 */
import { createNodeEnvFiles } from '../adapters/fs/env-files.ts'
import { createNodeSnapshotStore } from '../adapters/fs/snapshot-store.ts'
import { createGiteaEnvProbe } from '../adapters/gitea/env.ts'
import { createGithubEnvProbe } from '../adapters/github/env.ts'
import { createGitlabEnvProbe } from '../adapters/gitlab/env.ts'
import { createLocalIssuesProbe } from '../adapters/markdown/env.ts'
import { createNodeWorkspaceFiles } from '../adapters/markdown/files.ts'
import { TRACKER_LABELS } from '../protocol/labels.ts'
import { ERROR_CODES, RPC_METHODS, type RpcResult } from '../protocol/tracker.ts'
import { createAvatarService } from './avatar-service.ts'
import { createBackendResolver } from './backend-resolver.ts'
import { createEnvCheckService } from './env-check-service.ts'
import { createLog, type LogSink } from './log.ts'
import type { OrcaWorkerApi } from './orca-types.ts'
import { createProbeDeadline, ENV_PROBE_TIMEOUT_MS } from './probe-deadline.ts'
import {
  reportWorkspaceFailure,
  registerRpcHandlers,
  SNAPSHOT_REFRESHED_EVENT,
  workspaceFailureMessage,
} from './rpc-bridge.ts'
import { createSkillCatalog } from './skill-catalog.ts'
import { createSnapshotService, type SnapshotService } from './snapshot-service.ts'
import { createCommandRunner } from './subprocess-runner.ts'
import { createTicketService } from './ticket-service.ts'
import { createTicketWorktreeService } from './ticket-worktree-service.ts'
import { createTimer } from './timer.ts'
import { createWorkspaceResolver, type WorkspaceResolver } from './workspace-resolver.ts'

/** 插件自己注册的命令：刷新当前工作区的工单。 */
const REFRESH_COMMAND_ID = 'mattwf.refresh'
/** 把当前工作区切到 Orca 前台。 */
const OPEN_WORKSPACE_COMMAND_ID = 'mattwf.open-workspace'

/**
 * 激活插件。
 *
 * Orca 把这个对象传给 worker：面板请求从这里进，命令与事件从这里注册。
 * @param orca - worker API。
 */
export default function activate(orca: OrcaWorkerApi): void {
  const log = createLog(orca)
  const run = createCommandRunner()
  const timer = createTimer()
  const now = (): number => Date.now()
  const files = createNodeWorkspaceFiles()

  const resolve = createBackendResolver({ run, now, files })
  // 环境检查每次都重新探测后端：刚装好 glab / tea 或刚加上远端时要能马上看到变化。
  const resolveFresh = createBackendResolver({ run, now, files, cache: false })
  // 本地快照库：跨进程保存最近一次成功拉取的工单数据，宿主重启后面板仍能先出数据。
  const store = createNodeSnapshotStore()

  const snapshot = createSnapshotService({ resolve, now, labels: TRACKER_LABELS, log, store })
  const ticket = createTicketService({ resolve, now, log, store })
  const worktree = createTicketWorktreeService({ resolve, run, now, log })
  // 面板 frame 没有网络：头像由 worker 下载后转成 data URL。
  const avatar = createAvatarService()
  const envCheck = createEnvCheckService({
    resolve: resolveFresh,
    github: createGithubEnvProbe({ run }),
    gitlab: createGitlabEnvProbe({ run }),
    gitea: createGiteaEnvProbe({ run }),
    files: createNodeEnvFiles(),
    localIssues: createLocalIssuesProbe({ files }),
    skills: createSkillCatalog(),
    run,
    now,
    deadline: createProbeDeadline(timer, ENV_PROBE_TIMEOUT_MS),
    log,
  })

  const workspace = createWorkspaceResolver(orca.host, orca.storage)

  registerRpcHandlers(orca, { snapshot, ticket, worktree, envCheck, workspace, avatar, log })

  orca.commands.register(REFRESH_COMMAND_ID, async () => {
    // 主动刷新时重新认领一次：工作区可能刚被重命名、新建或关闭。
    workspace.invalidate()
    const result = await refreshWorkspace(orca, { snapshot, workspace, log })
    orca.panels.post(SNAPSHOT_REFRESHED_EVENT, { result })
    return result
  })

  orca.commands.register(OPEN_WORKSPACE_COMMAND_ID, async () => {
    const resolution = await workspace.resolve()
    if (resolution.status !== 'resolved') {
      reportWorkspaceFailure(orca, resolution, log)
      return '认不到当前工作区，请在面板顶部选一个。'
    }
    await orca.host.call('workspace.open', { workspaceId: resolution.candidate.id })
    return `已在 Orca 里打开 ${resolution.candidate.path}`
  })

  // 工作区切换后缓存的解析结果失效，面板随后用 workspace.current 重新问一次。
  orca.events.on('workspace.changed', () => {
    workspace.invalidate()
  })
}

/** 命令与桥接用到的服务。 */
interface RefreshDeps {
  readonly snapshot: SnapshotService
  readonly workspace: WorkspaceResolver
  readonly log: LogSink
}

/** 触发一次全量刷新；工作区认领不到时把候选推给面板（同一上下文只推一次）。 */
export async function refreshWorkspace(
  orca: OrcaWorkerApi,
  deps: RefreshDeps,
): Promise<RpcResult<unknown>> {
  const resolution = await deps.workspace.resolve()
  if (resolution.status !== 'resolved') {
    reportWorkspaceFailure(orca, resolution, deps.log)
    return {
      ok: false,
      error: {
        code: ERROR_CODES.invalidParams,
        message: workspaceFailureMessage(resolution),
      },
    }
  }
  return await deps.snapshot.handle(RPC_METHODS.snapshotRefresh, {
    workspaceRoot: resolution.root,
    full: true,
  })
}
