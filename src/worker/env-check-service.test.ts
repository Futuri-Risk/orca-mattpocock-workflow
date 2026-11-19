import { describe, expect, it, vi, type Mock } from 'vitest'

import type { EnvCommandProbe, ProbeOutcome } from '../core/env-check.ts'
import type { CommandRunner, Tracker } from '../core/ticket.ts'
import { RPC_METHODS, type RpcResult } from '../protocol/tracker.ts'
import type { EnvCheckReport } from '../protocol/env-check.ts'
import type { ResolvedBackend } from './backend-resolver.ts'
import {
  createEnvCheckService,
  type EnvCheckService,
  type EnvCheckServiceDeps,
} from './env-check-service.ts'

const WORKSPACE = '/workspace'
const GIT_REMOTES = [
  'origin\tgit@github.com:acme/repo.git (fetch)',
  'origin\tgit@github.com:acme/repo.git (push)',
].join('\n')

const PASS: ProbeOutcome = { status: 'pass', detail: 'ok' }
const FAIL: ProbeOutcome = { status: 'fail', detail: '未登录', reason: 'cli-unauthenticated' }

/** 一个探测成功的后端；fetchSnapshot 不会在环境检查里调用。 */
function resolved(): ResolvedBackend {
  return {
    kind: 'github',
    choice: { kind: 'github', source: 'remote' },
    address: { host: 'github.com', path: 'acme/repo' },
    tracker: {
      fetchSnapshot: () => Promise.reject(new Error('环境检查不应读取工单')),
    } as Tracker,
  }
}

/** 全通过的命令行探测。 */
function passingProbe(kind: EnvCommandProbe['kind']): EnvCommandProbe {
  return {
    kind,
    cli: async () => PASS,
    auth: async () => PASS,
    repository: async () => PASS,
  }
}

/** 一套全部通过的假环境；`failingAuth` 让登录检查失败，`throwingHome` 让探测自身失败。 */
function harness(options: { failingAuth?: boolean; throwingHome?: boolean } = {}): {
  readonly service: EnvCheckService
  readonly auth: Mock<EnvCommandProbe['auth']>
  attempts(): number
  advance(ms: number): void
} {
  let now = 1_700_000_000_000
  let attempts = 0
  const auth = vi.fn<EnvCommandProbe['auth']>(async () =>
    options.failingAuth === true ? FAIL : PASS,
  )
  const run: CommandRunner = async (command, args) => {
    if (command === 'git') return { stdout: GIT_REMOTES, stderr: '' }
    if (args.includes('--version')) return { stdout: 'orca 1.2.3', stderr: '' }
    if (command === 'tea') return { stdout: '[]', stderr: '' }
    return { stdout: '✓ Logged in to github.com as me (oauth_token)', stderr: '' }
  }
  const deps: EnvCheckServiceDeps = {
    resolve: async () => resolved(),
    github: { ...passingProbe('github'), auth },
    gitlab: passingProbe('gitlab'),
    gitea: passingProbe('gitea'),
    files: {
      homeDirectory: () => {
        attempts += 1
        if (options.throwingHome === true) throw new Error('探测失败')
        return '/home/me'
      },
      isFile: async () => true,
    },
    localIssues: async () => ({ status: 'no-scratch' }),
    skills: {
      names: async () => ['mattwf-bug'],
      locate: async (_root, name) => `/skills/${name}`,
    },
    run,
    resolveExecutable: async (command) => `/usr/bin/${command}`,
    now: () => now,
    deadline: async (task) => ({ ok: true, value: await task }),
    log: () => {},
  }
  return {
    service: createEnvCheckService(deps),
    auth,
    attempts: () => attempts,
    advance(ms) {
      now += ms
    },
  }
}

/** 手动开关的闸门：测试用它在不推进真实时间的前提下观察并发。 */
function openGate(): { wait(): Promise<void>; open(): void } {
  // 目标 lib 是 ES2023，类型库里没有 Promise.withResolvers。
  let open = (): void => undefined
  const waiting = new Promise<void>((resolve) => {
    open = resolve
  })
  return { wait: () => waiting, open: () => open() }
}

function reportOf(result: RpcResult<EnvCheckReport>): EnvCheckReport {
  if (!result.ok) throw new Error(`预期成功，实际失败：${result.error.message}`)
  return result.result
}

describe('环境检查缓存', () => {
  it('成功报告 10 分钟内命中缓存，不再重复探测', async () => {
    const { service, auth, advance } = harness()

    const first = reportOf(await service.handle(RPC_METHODS.envCheck, { workspaceRoot: WORKSPACE }))
    advance(5 * 60 * 1000)
    const second = reportOf(await service.handle(RPC_METHODS.envCheck, { workspaceRoot: WORKSPACE }))

    expect(auth).toHaveBeenCalledTimes(1)
    expect(second.checkedAt).toBe(first.checkedAt)
  })

  it('超过 10 分钟后重新探测', async () => {
    const { service, auth, advance } = harness()

    const first = reportOf(await service.handle(RPC_METHODS.envCheck, { workspaceRoot: WORKSPACE }))
    advance(10 * 60 * 1000 + 1)
    const second = reportOf(await service.handle(RPC_METHODS.envCheck, { workspaceRoot: WORKSPACE }))

    expect(auth).toHaveBeenCalledTimes(2)
    expect(second.checkedAt).toBeGreaterThan(first.checkedAt)
  })

  it('失败报告不缓存，修好后可以立即重试', async () => {
    const { service, auth, advance } = harness({ failingAuth: true })

    const first = reportOf(await service.handle(RPC_METHODS.envCheck, { workspaceRoot: WORKSPACE }))
    expect(first.items.some((item) => item.status === 'fail')).toBe(true)

    advance(1)
    const second = reportOf(await service.handle(RPC_METHODS.envCheck, { workspaceRoot: WORKSPACE }))
    expect(auth).toHaveBeenCalledTimes(2)
    expect(second.checkedAt).toBeGreaterThan(first.checkedAt)
  })

  it('探测本身连续失败时按递增间隔挡住重复探测', async () => {
    const { service, attempts, advance } = harness({ throwingHome: true })

    const first = await service.handle(RPC_METHODS.envCheck, { workspaceRoot: WORKSPACE })
    expect(first.ok).toBe(false)
    const blocked = await service.handle(RPC_METHODS.envCheck, { workspaceRoot: WORKSPACE })

    expect(attempts()).toBe(1)
    expect(blocked.ok).toBe(false)
    if (blocked.ok) return
    expect(blocked.error.message).toContain('秒后可重试')

    advance(8_000)
    await service.handle(RPC_METHODS.envCheck, { workspaceRoot: WORKSPACE })
    // 第二次失败后的退避翻到 16 秒。
    advance(10_000)
    const stillBlocked = await service.handle(RPC_METHODS.envCheck, { workspaceRoot: WORKSPACE })
    expect(attempts()).toBe(2)
    expect(stillBlocked.ok).toBe(false)
  })

  it('用户手动重检绕过成功缓存与失败退避', async () => {
    const { service, auth } = harness()

    await service.handle(RPC_METHODS.envCheck, { workspaceRoot: WORKSPACE })
    await service.handle(RPC_METHODS.envCheck, { workspaceRoot: WORKSPACE, force: true })

    expect(auth).toHaveBeenCalledTimes(2)
  })

  it('不同工作区各存各的，旧报告不误用', async () => {
    const { service, auth, advance } = harness()
    await service.handle(RPC_METHODS.envCheck, { workspaceRoot: WORKSPACE })

    advance(1_000)
    await service.handle(RPC_METHODS.envCheck, { workspaceRoot: '/other' })

    expect(auth).toHaveBeenCalledTimes(2)
  })

  it('同一工作区的并发检查复用一次探测', async () => {
    const gate = openGate()
    let calls = 0
    const auth = vi.fn<EnvCommandProbe['auth']>(async () => {
      calls += 1
      await gate.wait()
      return PASS
    })
    const run: CommandRunner = async (command, args) => {
      if (command === 'git') return { stdout: GIT_REMOTES, stderr: '' }
      if (args.includes('--version')) return { stdout: 'orca 1.2.3', stderr: '' }
      if (command === 'tea') return { stdout: '[]', stderr: '' }
      return { stdout: '✓ Logged in to github.com as me (oauth_token)', stderr: '' }
    }
    const service = createEnvCheckService({
      resolve: async () => resolved(),
      github: { ...passingProbe('github'), auth },
      gitlab: passingProbe('gitlab'),
      gitea: passingProbe('gitea'),
      files: { homeDirectory: () => '/home/me', isFile: async () => true },
      localIssues: async () => ({ status: 'no-scratch' }),
      skills: {
        names: async () => ['mattwf-bug'],
        locate: async (_root, name) => `/skills/${name}`,
      },
      run,
      resolveExecutable: async (command) => `/usr/bin/${command}`,
      now: () => 1_700_000_000_000,
      deadline: async (task) => ({ ok: true, value: await task }),
      log: () => {},
    })

    const first = service.handle(RPC_METHODS.envCheck, { workspaceRoot: WORKSPACE })
    const second = service.handle(RPC_METHODS.envCheck, { workspaceRoot: WORKSPACE })
    gate.open()
    const [one, two] = await Promise.all([first, second])

    expect(calls).toBe(1)
    expect(one).toEqual(two)
  })
})
