/**
 * 环境检查服务：按 core 给出的检查项与依赖关系调度探测。
 *
 * - 互不依赖的探测并发执行，前置项失败就不再跑依赖它的探测；
 * - 每个探测都有超时，超时按失败处理；
 * - 同一工作区有检查在跑时，新请求复用进行中的那一次；
 * - 日志只记耗时和通过/失败数量，不记命令原始输出。
 *
 * 「能力诊断」列的是 Orca 侧真实存在的条件——三个后端 CLI 是否安装与登录、
 * 仓库有没有远端、工作区有没有初始化、本地工单目录能不能读、
 * 入池技能与 matt 技能装没装。
 */
import { join } from 'node:path'

import type { EnvFiles } from '../adapters/fs/env-files.ts'
import type { LocalIssuesProbe } from '../adapters/markdown/env.ts'
import type {
  BackendProbeOutcome,
  EnvCheckFacts,
  EnvCommandProbe,
  LocalIssuesFact,
  ProbeOutcome,
  SkillProbeFact,
} from '../core/env-check.ts'
import { buildEnvCheckItems, shouldCheckLocalIssues } from '../core/env-check.ts'
import { parseLoggedInHosts, parseTeaLoginHosts, type BackendChoice } from '../core/backend.ts'
import type { RepositoryAddress } from '../core/remote.ts'
import type { CommandRunner } from '../core/ticket.ts'
import { TrackerError } from '../core/tracker-error.ts'
import type { BackendKind } from '../protocol/backend.ts'
import { LOG_EVENTS } from '../protocol/log-events.ts'
import {
  PANEL_SKILLS,
  REQUIRED_SKILLS,
  type CapabilityDiagnostic,
  type EnvCheckReport,
} from '../protocol/env-check.ts'
import {
  ERROR_BACKENDS,
  ERROR_CODES,
  RPC_METHODS,
  type ErrorCode,
  type RpcResult,
} from '../protocol/tracker.ts'
import type { BackendResolver } from './backend-resolver.ts'
import type { LogSink } from './log.ts'
import { resolveOrcaCli } from './orca-cli.ts'
import type { ProbeDeadline } from './probe-deadline.ts'
import { resolveExecutable } from './subprocess-runner.ts'
import { FLOW_COMMANDS } from '../protocol/flow.ts'

/** 工作区初始化后的工单操作说明；存在即视为已初始化。 */
const TRACKER_DOC = 'docs/agents/issue-tracker.md'

/**
 * 能力诊断项的 id。界面按 id 渲染标题，这里只给稳定标识。
 */
export const ORCA_CAPABILITY_IDS = {
  /** gh 是否安装。 */
  cliGh: 'cli.gh',
  /** gh 是否登录了某个实例。 */
  cliGhAuth: 'cli.gh.auth',
  /** glab 是否安装。 */
  cliGlab: 'cli.glab',
  /** glab 是否登录了某个实例。 */
  cliGlabAuth: 'cli.glab.auth',
  /** tea 是否安装。 */
  cliTea: 'cli.tea',
  /** tea 是否登录了某个实例。 */
  cliTeaAuth: 'cli.tea.auth',
  /** 仓库有没有远端。 */
  remote: 'remote',
  /** 工作区有没有初始化。 */
  workspace: 'workspace',
  /** 本地工单目录能不能读。 */
  localIssues: 'local-issues',
} as const

/** 技能清单的读取能力。 */
export interface SkillCatalog {
  /** 当前工作区可见的技能名；读取失败时是空列表。 */
  names(workspaceRoot: string): Promise<readonly string[]>
  /** 某个技能在哪个目录里；没有找到时是 undefined。 */
  locate(workspaceRoot: string, name: string): Promise<string | undefined>
}

/** 环境检查服务依赖。 */
export interface EnvCheckServiceDeps {
  /** 与快照共用同一个后端解析器，两边对后端的判定不会分叉。 */
  readonly resolve: BackendResolver
  readonly github: EnvCommandProbe
  readonly gitlab: EnvCommandProbe
  readonly gitea: EnvCommandProbe
  readonly files: EnvFiles
  /** 本地工单目录探测；只在本地 Markdown 或后端未判定时调用。 */
  readonly localIssues: LocalIssuesProbe
  /** 技能目录扫描；Orca 没有技能服务，只能看磁盘。 */
  readonly skills: SkillCatalog
  /** 命令执行器；能力诊断要自己确认三个 CLI 装没装、登录没登录。 */
  readonly run: CommandRunner
  readonly now: () => number
  readonly deadline: ProbeDeadline
  readonly log: LogSink
}

/** 宿主对界面的环境检查入口。 */
export interface EnvCheckService {
  /**
   * 处理 `env.check`。
   * @param method - 方法名；不是 `env.check` 时返回 unknown-method。
   * @param params - `{ workspaceRoot }`。
   * @returns 检查报告或带错误码的失败。
   */
  handle(method: string, params: unknown): Promise<RpcResult<EnvCheckReport>>
}

/**
 * 创建环境检查服务。
 * @param deps - 探测、文件、技能清单、时钟与日志出口。
 * @returns 环境检查服务。
 */
export function createEnvCheckService(deps: EnvCheckServiceDeps): EnvCheckService {
  const pending = new Map<string, Promise<RpcResult<EnvCheckReport>>>()

  return {
    handle(method, params) {
      if (method !== RPC_METHODS.envCheck) {
        return Promise.resolve(failure(ERROR_CODES.unknownMethod, `未知方法：${method}`))
      }

      const workspaceRoot = readWorkspaceRoot(params)
      if (workspaceRoot === undefined) {
        return Promise.resolve(
          failure(ERROR_CODES.invalidParams, '缺少非空的 workspaceRoot 参数。'),
        )
      }

      // 同一工作区已有检查在跑：复用同一个 Promise，避免并发探测。
      const running = pending.get(workspaceRoot)
      if (running !== undefined) return running

      const task = runCheck(deps, workspaceRoot)
      pending.set(workspaceRoot, task)
      void task.then(
        () => {
          pending.delete(workspaceRoot)
        },
        () => {
          pending.delete(workspaceRoot)
        },
      )
      return task
    },
  }
}

async function runCheck(
  deps: EnvCheckServiceDeps,
  workspaceRoot: string,
): Promise<RpcResult<EnvCheckReport>> {
  const startedAt = deps.now()

  try {
    const collected = await collectFacts(deps, workspaceRoot)
    const items = buildEnvCheckItems(collected.facts)
    const report: EnvCheckReport = {
      checkedAt: startedAt,
      backend:
        collected.facts.backend.status === 'pass' ? collected.facts.backend.choice.kind : null,
      repository: collected.repository,
      items,
      capabilities: collected.capabilities,
    }
    logSummary(deps, report, startedAt)
    return { ok: true, result: report }
  } catch {
    deps.log('warn', LOG_EVENTS.envCheck, {
      result: 'error',
      durationMs: Math.max(0, deps.now() - startedAt),
    })
    return failure(ERROR_CODES.internal, '环境检查时发生未预期的错误。')
  }
}

interface CollectedFacts {
  readonly facts: EnvCheckFacts
  /** 后端判定出的仓库路径；本地 Markdown 或判定失败时为 null。 */
  readonly repository: string | null
  /** Orca 侧的能力诊断。 */
  readonly capabilities: readonly CapabilityDiagnostic[]
}

async function collectFacts(
  deps: EnvCheckServiceDeps,
  workspaceRoot: string,
): Promise<CollectedFacts> {
  const home = deps.files.homeDirectory()
  const homeOutcome: ProbeOutcome =
    home === undefined
      ? { status: 'fail', detail: '无法解析用户主目录', reason: 'home-unresolved' }
      : { status: 'pass', detail: home }

  // 主目录、后端、工作区与技能互不依赖，并发探测；本地工单目录与命令行链等后端结果。
  const [backend, workspace, skills, tools, orca] = await Promise.all([
    probeBackend(deps, workspaceRoot),
    probeWorkspace(deps.files, workspaceRoot),
    home === undefined ? Promise.resolve(unprobedSkills()) : probeSkills(deps, workspaceRoot),
    probeTools(deps),
    probeOrcaCli(deps),
  ])
  // 托管后端的工单完全来自远端：不探测本地目录，也就不会产出这一项。
  const [commands, localIssues] = await Promise.all([
    probeCommands(deps, workspaceRoot, backend),
    shouldCheckLocalIssues(backend.outcome)
      ? probeLocalIssues(deps, workspaceRoot)
      : Promise.resolve(undefined),
  ])
  const decided = backend.outcome.status === 'pass' ? backend.outcome.choice.kind : null

  const facts: EnvCheckFacts = {
    home: homeOutcome,
    backend: backend.outcome,
    workspace,
    localIssues,
    orca,
    cli: commands.cli,
    auth: commands.auth,
    repository: commands.repository,
    skills,
    setupSkill: PANEL_SKILLS.setup,
  }

  return {
    facts,
    repository: decided === null || decided === 'markdown' ? null : (backend.remote?.path ?? null),
    capabilities: await buildCapabilities(
      deps,
      workspaceRoot,
      backend,
      tools,
      skills,
      localIssues,
      workspace,
    ),
  }
}

/**
 * 探测 Orca 命令行。找不到时归为「命令行缺失」，解决区给出安装或设置
 * `ORCA_CLI_COMMAND` 的办法；探测本身超时或异常则按重试处理。
 * @param deps - 服务依赖。
 * @returns 版本确认后的可执行文件路径，或失败原因。
 */
async function probeOrcaCli(deps: EnvCheckServiceDeps): Promise<ProbeOutcome> {
  try {
    const result = await deps.deadline(resolveOrcaCli(deps.run))
    if (!result.ok) {
      return { status: 'fail', detail: 'Orca 命令行探测超时', reason: 'timeout' }
    }
    if (result.value === undefined) {
      return { status: 'fail', detail: '未找到 Orca 命令行', reason: 'orca-cli-missing' }
    }
    return { status: 'pass', detail: result.value.executable ?? result.value.command }
  } catch {
    return { status: 'fail', detail: 'Orca 命令行探测失败', reason: 'probe-failed' }
  }
}

async function probeLocalIssues(
  deps: EnvCheckServiceDeps,
  workspaceRoot: string,
): Promise<LocalIssuesFact> {
  try {
    const result = await deps.deadline(deps.localIssues(workspaceRoot))
    return result.ok ? result.value : { status: 'probe-failed' }
  } catch {
    return { status: 'probe-failed' }
  }
}

interface BackendProbeResult {
  readonly outcome: BackendProbeOutcome
  readonly remote: RepositoryAddress | undefined
}

async function probeBackend(
  deps: EnvCheckServiceDeps,
  workspaceRoot: string,
): Promise<BackendProbeResult> {
  try {
    const result = await deps.deadline(deps.resolve(workspaceRoot))
    if (!result.ok) {
      return {
        outcome: { status: 'fail', detail: '后端判定超时', reason: 'timeout' },
        remote: undefined,
      }
    }

    const resolved = result.value
    // 只能回退本地、但差一步就能用上托管后端：判定项点名候选后端与原因。
    if (resolved.choice.kind === 'markdown' && resolved.candidate !== undefined) {
      return {
        outcome: {
          status: 'fail',
          detail: resolved.candidate.detail,
          reason: resolved.candidate.reason,
          backend: resolved.candidate.kind,
        },
        remote: resolved.address,
      }
    }

    return {
      outcome: {
        status: 'pass',
        choice: resolved.choice,
        detail: backendDetail(resolved.choice, resolved.address),
      },
      remote: resolved.address,
    }
  } catch (error) {
    if (error instanceof TrackerError) {
      const backend = ERROR_BACKENDS[error.code]
      if (backend !== undefined) {
        // 环境类错误码的 message 是写好的说明，可以直接进报告；码尾区分缺工具与未登录。
        return {
          outcome: {
            status: 'fail',
            detail: error.message,
            reason: error.code.endsWith('-unauthenticated') ? 'cli-unauthenticated' : 'cli-missing',
            backend,
          },
          remote: undefined,
        }
      }
    }
    // 其余错误可能带命令输出，不进入报告；解决由 core 按原因选择。
    return {
      outcome: { status: 'fail', detail: '无法判定工单后端', reason: 'backend-unavailable' },
      remote: undefined,
    }
  }
}

function backendDetail(choice: BackendChoice, address: RepositoryAddress | undefined): string {
  const basis = `${choice.source}:${choice.kind}`
  // 判定来源之后补上远端主机：自建实例同名仓库很多，用户要能核对认的是哪一台。
  return address === undefined ? basis : `${basis}（${address.host}）`
}

async function probeWorkspace(files: EnvFiles, workspaceRoot: string): Promise<ProbeOutcome> {
  const exists = await files.isFile(join(workspaceRoot, TRACKER_DOC))
  return exists
    ? { status: 'pass', detail: `${TRACKER_DOC} 存在` }
    : { status: 'fail', detail: `未找到 ${TRACKER_DOC}`, reason: 'workspace-uninitialized' }
}

interface CommandFacts {
  readonly cli: ProbeOutcome | undefined
  readonly auth: ProbeOutcome | undefined
  readonly repository: ProbeOutcome | undefined
}

async function probeCommands(
  deps: EnvCheckServiceDeps,
  workspaceRoot: string,
  backend: BackendProbeResult,
): Promise<CommandFacts> {
  const none: CommandFacts = { cli: undefined, auth: undefined, repository: undefined }
  const outcome = backend.outcome
  if (outcome.status !== 'pass') return none
  // 本地 Markdown 没有命令行探测；其余后端各用自己注入的探测。
  if (outcome.choice.kind === 'markdown') return none

  const probe = probeFor(deps, outcome.choice.kind)
  const remote = backend.remote

  const cli = await guarded(deps, probe.cli(workspaceRoot), '命令行检查失败')
  if (cli.status !== 'pass') return { cli, auth: undefined, repository: undefined }

  const auth = await guarded(deps, probe.auth(workspaceRoot, remote), '登录检查失败')
  if (auth.status !== 'pass') return { cli, auth, repository: undefined }

  const repository = await guarded(deps, probe.repository(workspaceRoot, remote), '仓库检查失败')
  return { cli, auth, repository }
}

function probeFor(
  deps: EnvCheckServiceDeps,
  kind: Exclude<BackendKind, 'markdown'>,
): EnvCommandProbe {
  switch (kind) {
    case 'github':
      return deps.github
    case 'gitlab':
      return deps.gitlab
    case 'gitea':
      return deps.gitea
  }
}

async function guarded(
  deps: EnvCheckServiceDeps,
  task: Promise<ProbeOutcome>,
  failureDetail: string,
): Promise<ProbeOutcome> {
  try {
    const result = await deps.deadline(task)
    return result.ok ? result.value : { status: 'fail', detail: '探测超时', reason: 'timeout' }
  } catch {
    return { status: 'fail', detail: failureDetail, reason: 'probe-failed' }
  }
}

function unprobedSkills(): readonly SkillProbeFact[] {
  return REQUIRED_SKILLS.map((name) => ({ name, outcome: undefined }))
}

/**
 * 探测 matt 技能是否装在 agent 会扫描的目录里。
 * @param deps - 服务依赖。
 * @param workspaceRoot - 工作区根目录。
 * @returns 每项技能的探测结果。
 */
async function probeSkills(
  deps: EnvCheckServiceDeps,
  workspaceRoot: string,
): Promise<readonly SkillProbeFact[]> {
  const installed = await deps.skills.names(workspaceRoot)
  return await Promise.all(
    REQUIRED_SKILLS.map(async (name) => {
      const found = await deps.skills.locate(workspaceRoot, name)
      if (found !== undefined) {
        return { name, outcome: { status: 'pass', detail: found } as const }
      }
      // 一个技能都没扫到：更可能是技能目录本身不可读，而不是少装了一个。
      const detail =
        installed.length === 0 ? '技能目录为空或不可读' : '技能目录里没有找到'
      return {
        name,
        outcome: { status: 'fail', detail, reason: 'skill-missing' } as const,
      }
    }),
  )
}

/** 一个后端 CLI 的安装与登录状态。 */
interface ToolState {
  readonly installed: boolean
  readonly loggedIn: boolean
}

/** 三个后端 CLI 的安装与登录状态。 */
type ToolStates = readonly [ToolState, ToolState, ToolState]

/**
 * 探测三个后端 CLI：装没装、登录没登录。
 *
 * 这与后端判定用的是同一批命令，但后端判定只在选中某个后端时才跑；
 * 能力诊断要回答「这台机器上到底有什么」，所以三个都查一遍。
 * @param deps - 服务依赖。
 * @returns 三个 CLI 的状态。
 */
async function probeTools(deps: EnvCheckServiceDeps): Promise<ToolStates> {
  const [gh, glab, tea] = await Promise.all([
    probeTool(deps, 'gh'),
    probeTool(deps, 'glab'),
    probeTool(deps, 'tea'),
  ])
  return [gh, glab, tea]
}

/** 探测一个 CLI。 */
async function probeTool(deps: EnvCheckServiceDeps, name: string): Promise<ToolState> {
  try {
    await resolveExecutable(name)
  } catch {
    return { installed: false, loggedIn: false }
  }

  try {
    const hosts = await deps.deadline(readLoggedInHosts(deps.run, name))
    return { installed: true, loggedIn: hosts.ok && hosts.value.length > 0 }
  } catch {
    return { installed: true, loggedIn: false }
  }
}

/** 读一个 CLI 登录了哪些实例。 */
async function readLoggedInHosts(
  run: CommandRunner,
  name: string,
): Promise<readonly string[]> {
  if (name === 'tea') {
    const output = await run('tea', ['logins', 'list', '--output', 'json'])
    return parseTeaLoginHosts(output.stdout)
  }
  const output = await run(name, ['auth', 'status'])
  // gh 与 glab 都把登录状态写在标准错误上；不同版本也可能写标准输出，两边都认。
  return parseLoggedInHosts(`${output.stdout}\n${output.stderr}`)
}

/**
 * 组装 Orca 侧的能力诊断。
 *
 * 缺项按「missing」给出，解决方式由检查项（items）里的 remedy 承担。
 * @param deps - 服务依赖。
 * @param workspaceRoot - 工作区根目录。
 * @param backend - 后端判定结果。
 * @param tools - 三个 CLI 的状态。
 * @param skills - matt 技能的探测结果。
 * @param localIssues - 本地工单目录的探测事实。
 * @param workspace - 工作区初始化的探测结果。
 * @returns 能力诊断列表。
 */
async function buildCapabilities(
  deps: EnvCheckServiceDeps,
  workspaceRoot: string,
  backend: BackendProbeResult,
  tools: ToolStates,
  skills: readonly SkillProbeFact[],
  localIssues: LocalIssuesFact | undefined,
  workspace: ProbeOutcome,
): Promise<readonly CapabilityDiagnostic[]> {
  const poolSkills = await Promise.all(
    [FLOW_COMMANDS.intakeBug.name, FLOW_COMMANDS.intakeFeature.name].map(
      async (name): Promise<CapabilityDiagnostic> => ({
        id: `skill.${name}`,
        category: 'host-service',
        status: (await deps.skills.locate(workspaceRoot, name)) === undefined ? 'missing' : 'present',
      }),
    ),
  )

  const mattSkills = skills.map(
    (skill): CapabilityDiagnostic => ({
      id: `skill.${skill.name}`,
      category: 'host-service',
      status: skill.outcome?.status === 'pass' ? 'present' : 'missing',
    }),
  )

  const cli = tools.map(
    (tool, index): CapabilityDiagnostic => ({
      id: index === 0 ? ORCA_CAPABILITY_IDS.cliGh : index === 1 ? ORCA_CAPABILITY_IDS.cliGlab : ORCA_CAPABILITY_IDS.cliTea,
      category: 'host-service',
      status: tool.installed ? 'present' : 'missing',
    }),
  )

  const auth = tools.map(
    (tool, index): CapabilityDiagnostic => ({
      id:
        index === 0
          ? ORCA_CAPABILITY_IDS.cliGhAuth
          : index === 1
            ? ORCA_CAPABILITY_IDS.cliGlabAuth
            : ORCA_CAPABILITY_IDS.cliTeaAuth,
      category: 'host-service',
      status: tool.loggedIn ? 'present' : 'missing',
    }),
  )

  return [
    ...cli,
    ...auth,
    {
      id: ORCA_CAPABILITY_IDS.remote,
      category: 'host-service',
      status: backend.remote === undefined ? 'missing' : 'present',
    },
    {
      id: ORCA_CAPABILITY_IDS.workspace,
      category: 'host-service',
      status: workspace.status === 'pass' ? 'present' : 'missing',
    },
    {
      id: ORCA_CAPABILITY_IDS.localIssues,
      category: 'host-service',
      status: localIssues?.status === 'found' ? 'present' : 'missing',
    },
    ...poolSkills,
    ...mattSkills,
  ]
}

function logSummary(deps: EnvCheckServiceDeps, report: EnvCheckReport, startedAt: number): void {
  let passed = 0
  let failed = 0
  let skipped = 0
  for (const item of report.items) {
    if (item.status === 'pass') passed += 1
    else if (item.status === 'fail') failed += 1
    else skipped += 1
  }

  deps.log('info', LOG_EVENTS.envCheck, {
    result: 'ok',
    backend: report.backend,
    durationMs: Math.max(0, deps.now() - startedAt),
    passed,
    failed,
    skipped,
  })
}

function readWorkspaceRoot(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null) return undefined
  if (!('workspaceRoot' in params)) return undefined
  const root = params.workspaceRoot
  return typeof root === 'string' && root.length > 0 ? root : undefined
}

function failure(code: ErrorCode, message: string): RpcResult<EnvCheckReport> {
  return { ok: false, error: { code, message } }
}