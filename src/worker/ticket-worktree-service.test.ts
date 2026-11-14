import { describe, expect, it } from 'vitest'

import type { TicketDetail } from '../core/ticket.ts'
import type { CommandRunner } from '../core/ticket.ts'
import { CommandError } from '../core/tracker-error.ts'
import type { BackendKind } from '../protocol/backend.ts'
import { ERROR_CODES, RPC_METHODS } from '../protocol/tracker.ts'
import type { BackendResolver, ResolvedBackend } from './backend-resolver.ts'
import type { LogSink } from './log.ts'
import { createTicketWorktreeService } from './ticket-worktree-service.ts'

const WORKSPACE = '/repo'
const ORCA = '/opt/homebrew/bin/orca'

interface Call {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string | undefined
  readonly timeoutMs: number | undefined
}

interface RunnerOptions {
  readonly version?: (command: string) => string | Error
  readonly list?: () => unknown
  readonly create?: (branch: string) => unknown
}

function runner(options: RunnerOptions): {
  readonly run: CommandRunner
  readonly calls: Call[]
} {
  const calls: Call[] = []
  const run: CommandRunner = async (command, args, settings) => {
    calls.push({
      command,
      args,
      cwd: settings?.cwd,
      timeoutMs: settings?.timeoutMs,
    })
    if (args.includes('--version')) {
      const reply = options.version?.(command) ?? '1.4.256'
      if (reply instanceof Error) throw reply
      return { stdout: reply, stderr: '', executable: command.startsWith('/') ? command : ORCA }
    }
    if (args.includes('current')) {
      return {
        stdout: JSON.stringify({
          id: 'op',
          ok: true,
          result: {
            worktree: {
              id: `repo-1::${WORKSPACE}`,
              repoId: 'repo-1',
              path: WORKSPACE,
              branch: 'refs/heads/main',
              displayName: 'main',
            },
          },
        }),
        stderr: '',
      }
    }
    if (args.includes('list')) {
      const reply = options.list?.() ?? worktreeList([])
      if (reply instanceof Error) throw reply
      return { stdout: JSON.stringify(reply), stderr: '' }
    }
    const branch = args[args.indexOf('--branch') + 1] ?? 'feat/6-ticket-one'
    const reply = options.create?.(branch) ?? worktreeCreate(branch)
    if (reply instanceof Error) throw reply
    return { stdout: JSON.stringify(reply), stderr: '' }
  }
  return { run, calls }
}

function worktreeList(
  worktrees: readonly Record<string, unknown>[],
): Record<string, unknown> {
  return { id: 'op', ok: true, result: { worktrees, totalCount: worktrees.length, truncated: false } }
}

function worktreeCreate(branch: string): Record<string, unknown> {
  return {
    id: 'op',
    ok: true,
    result: {
      worktree: {
        id: `repo::/orca/workspaces/${branch.replaceAll('/', '-')}`,
        path: `/orca/workspaces/${branch.replaceAll('/', '-')}`,
        branch: `refs/heads/${branch}`,
        displayName: 'Ticket one',
      },
      warnings: [],
    },
  }
}

function resolver(
  kind: BackendKind,
  detail: Partial<TicketDetail> = {},
): BackendResolver {
  return async (): Promise<ResolvedBackend> => ({
    kind,
    choice: { kind, source: kind === 'markdown' ? 'no-remote' : 'remote' },
    address:
      kind === 'markdown' ? undefined : { host: 'github.com', path: 'acme/repo' },
    tracker: {
      fetchSnapshot: async () => ({
        repository: 'acme/repo',
        fetchedAt: 0,
        loaded: 1,
        total: 1,
        tickets: [],
      }),
      fetchDetail: async () => ({
        ...detailOf(detail),
      }),
    },
  })
}

function detailOf(overrides: Partial<TicketDetail>): TicketDetail {
  return {
    ref: '#6',
    number: 6,
    title: 'Ticket one',
    state: 'open',
    author: null,
    body: '',
    labels: ['ready-for-agent'],
    assignees: [],
    comments: [],
    url: 'https://github.com/acme/repo/issues/6',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const log: LogSink = () => undefined

function service(
  resolve: BackendResolver,
  fake: ReturnType<typeof runner>,
): ReturnType<typeof createTicketWorktreeService> {
  return createTicketWorktreeService({
    resolve,
    run: fake.run,
    now: () => 0,
    log,
    candidates: () => ['orca'],
  })
}

describe('工单 worktree 服务', () => {
  it('按约定的参数在工单工作区里创建 worktree', async () => {
    const fake = runner({})
    const create = service(resolver('github'), fake)

    const result = await create.handle(RPC_METHODS.ticketWorktree, {
      workspaceRoot: WORKSPACE,
      ref: '#6',
      number: 6,
    })

    expect(result).toMatchObject({
      ok: true,
      result: {
        branch: 'feat/6-ticket-one',
        name: 'Ticket one',
        reference: 'https://github.com/acme/repo/issues/6',
        created: true,
      },
    })
    const list = fake.calls.find((call) => call.args.includes('list'))
    expect(list).toMatchObject({
      command: 'orca',
      args: ['worktree', 'list', '--repo', 'id:repo-1', '--json'],
      cwd: WORKSPACE,
    })
    const createCall = fake.calls.find((call) => call.args.includes('create'))
    expect(createCall).toMatchObject({
      command: 'orca',
      args: [
        'worktree',
        'create',
        '--name',
        'Ticket one',
        '--branch',
        'feat/6-ticket-one',
        '--reference',
        'https://github.com/acme/repo/issues/6',
        '--comment',
        '#6 Ticket one',
        '--activate',
        '--json',
      ],
      cwd: WORKSPACE,
      timeoutMs: 120_000,
    })
    expect(createCall?.args).not.toContain('--issue')
  })

  it.each([
    ['英文标题', 'Fix crash on login', ['bug'], 'bugfix/6-fix-crash-on-login'],
    ['中文标题退化成票号', '修复登录崩溃', [], 'feat/6'],
    ['连字符折叠并去掉首尾', '--Orca  worktree--', [], 'feat/6-orca-worktree'],
  ])('分支名推导：%s', async (_label, title, labels, branch) => {
    const fake = runner({})
    const create = service(resolver('github', { title, labels }), fake)

    const result = await create.handle(RPC_METHODS.ticketWorktree, {
      workspaceRoot: WORKSPACE,
      ref: '#6',
      number: 6,
    })

    expect(result).toMatchObject({ ok: true, result: { branch } })
    const createCall = fake.calls.find((call) => call.args.includes('create'))
    expect(createCall?.args).toContain(branch)
  })

  it('超长标题的分支名截断到 40 字符 slug', async () => {
    const title = `Add ${'very-long-title-'.repeat(8)}end`
    const fake = runner({})
    const create = service(resolver('github', { title }), fake)

    const result = await create.handle(RPC_METHODS.ticketWorktree, {
      workspaceRoot: WORKSPACE,
      ref: '#6',
      number: 6,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    const branch = result.result.branch
    expect(branch.startsWith('feat/6-')).toBe(true)
    expect(branch.length).toBeLessThanOrEqual('feat/6-'.length + 40)
  })

  it('工单链接取自后端详情，不用仓库名与票号拼接', async () => {
    const reference = 'https://gitlab.example.com/group/project/-/issues/6'
    const fake = runner({})
    const create = service(resolver('gitlab', { url: reference }), fake)

    const result = await create.handle(RPC_METHODS.ticketWorktree, {
      workspaceRoot: WORKSPACE,
      ref: '#6',
      number: 6,
    })

    expect(result).toMatchObject({ ok: true, result: { reference } })
    const createCall = fake.calls.find((call) => call.args.includes('create'))
    expect(createCall?.args[createCall.args.indexOf('--reference') + 1]).toBe(reference)
    expect(createCall?.args).not.toContain('--gitlab-issue')
  })

  it('后端给不出链接时不调用 Orca 命令行', async () => {
    const fake = runner({})
    const create = service(resolver('github', { url: null }), fake)

    const result = await create.handle(RPC_METHODS.ticketWorktree, {
      workspaceRoot: WORKSPACE,
      ref: '#6',
      number: 6,
    })

    expect(result).toMatchObject({ ok: false, error: { code: ERROR_CODES.capabilityUnsupported } })
    expect(fake.calls).toHaveLength(0)
  })

  it('本地 Markdown 工单不提供 worktree', async () => {
    const fake = runner({})
    const create = service(resolver('markdown', { url: null, number: null }), fake)

    const result = await create.handle(RPC_METHODS.ticketWorktree, {
      workspaceRoot: WORKSPACE,
      ref: '.scratch/login/issues/01-token.md',
      number: null,
    })

    expect(result).toMatchObject({ ok: false, error: { code: ERROR_CODES.capabilityUnsupported } })
    expect(fake.calls).toHaveLength(0)
  })

  it('找不到 Orca 命令行时返回专用错误码', async () => {
    const fake = runner({
      version: () => new CommandError('not-found', '找不到可执行文件：orca'),
    })
    const create = service(resolver('github'), fake)

    const result = await create.handle(RPC_METHODS.ticketWorktree, {
      workspaceRoot: WORKSPACE,
      ref: '#6',
      number: 6,
    })

    expect(result).toMatchObject({ ok: false, error: { code: ERROR_CODES.orcaMissing } })
  })

  it('候选命令的版本输出不像 Orca 时继续试下一个', async () => {
    const fake = runner({
      version: (command) => (command === 'orca' ? 'screen reader' : '1.4.256'),
    })
    const create = createTicketWorktreeService({
      resolve: resolver('github'),
      run: fake.run,
      now: () => 0,
      log,
      candidates: () => ['orca', '/usr/local/bin/orca'],
    })

    const result = await create.handle(RPC_METHODS.ticketWorktree, {
      workspaceRoot: WORKSPACE,
      ref: '#6',
      number: 6,
    })

    expect(result).toMatchObject({ ok: true })
    const createCall = fake.calls.find((call) => call.args.includes('create'))
    expect(createCall?.command).toBe('/usr/local/bin/orca')
  })

  it('创建命令非零退出时返回失败并带上诊断', async () => {
    const fake = runner({
      create: () =>
        new CommandError('failed', 'orca 退出码 1', 'repo is locked by another operation'),
    })
    const create = service(resolver('github'), fake)

    const result = await create.handle(RPC_METHODS.ticketWorktree, {
      workspaceRoot: WORKSPACE,
      ref: '#6',
      number: 6,
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: ERROR_CODES.worktreeCreateFailed,
        message: expect.stringContaining('repo is locked by another operation'),
      },
    })
  })

  it('命令超时时返回创建失败并说明超时', async () => {
    const fake = runner({
      create: () => new CommandError('timeout', 'orca 超时（120 秒）', '', null),
    })
    const create = service(resolver('github'), fake)

    const result = await create.handle(RPC_METHODS.ticketWorktree, {
      workspaceRoot: WORKSPACE,
      ref: '#6',
      number: 6,
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: ERROR_CODES.worktreeCreateFailed,
        message: expect.stringContaining('超时'),
      },
    })
  })

  it('同分支已有 worktree 时返回既有工作区且不再创建', async () => {
    const branch = 'feat/6-ticket-one'
    const path = `/orca/workspaces/${branch.replaceAll('/', '-')}`
    const fake = runner({
      list: () => worktreeList([{ id: `repo::${path}`, path, branch: `refs/heads/${branch}` }]),
    })
    const create = service(resolver('github'), fake)

    const result = await create.handle(RPC_METHODS.ticketWorktree, {
      workspaceRoot: WORKSPACE,
      ref: '#6',
      number: 6,
    })

    expect(result).toMatchObject({
      ok: true,
      result: { path, branch, created: false },
    })
    expect(fake.calls.some((call) => call.args.includes('create'))).toBe(false)
  })

  it('参数不合法时不发命令行', async () => {
    const fake = runner({})
    const create = service(resolver('github'), fake)

    const result = await create.handle(RPC_METHODS.ticketWorktree, { workspaceRoot: WORKSPACE })

    expect(result).toMatchObject({ ok: false, error: { code: ERROR_CODES.invalidParams } })
    expect(fake.calls).toHaveLength(0)
  })

  it('列表或创建输出不是可识别的 JSON 时返回创建失败', async () => {
    const badList = runner({ list: () => 'not json' })
    const listCreate = service(resolver('github'), badList)
    const listResult = await listCreate.handle(RPC_METHODS.ticketWorktree, {
      workspaceRoot: WORKSPACE,
      ref: '#6',
      number: 6,
    })
    expect(listResult).toMatchObject({
      ok: false,
      error: { code: ERROR_CODES.worktreeCreateFailed },
    })

    const badCreate = runner({ create: () => ({ result: {} }) })
    const createResult = await service(resolver('github'), badCreate).handle(
      RPC_METHODS.ticketWorktree,
      { workspaceRoot: WORKSPACE, ref: '#6', number: 6 },
    )
    expect(createResult).toMatchObject({
      ok: false,
      error: { code: ERROR_CODES.worktreeCreateFailed },
    })
  })
})
