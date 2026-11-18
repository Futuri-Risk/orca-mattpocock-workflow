import { beforeEach, describe, expect, it } from 'vitest'

import { RPC_METHODS, type RpcResult } from '../protocol/tracker.ts'
import type { AvatarService } from './avatar-service.ts'
import type { EnvCheckService } from './env-check-service.ts'
import type { LogSink } from './log.ts'
import type { OrcaPanelRequestHandler, OrcaWorkerApi } from './orca-types.ts'
import { refreshWorkspace } from './main.ts'
import {
  registerRpcHandlers,
  resetWorkspaceCandidatesReport,
  SKILL_INSTALL_REQUEST,
  WORKSPACE_CANDIDATES_EVENT,
  WORKSPACE_CURRENT_REQUEST,
} from './rpc-bridge.ts'
import type { SnapshotService } from './snapshot-service.ts'
import type { SkillCommandService } from './skill-command-service.ts'
import type { TicketService } from './ticket-service.ts'
import type { TicketWorktreeService } from './ticket-worktree-service.ts'
import { createWorkspaceResolver } from './workspace-resolver.ts'

/** 收集注册下来的面板处理器与推给面板的事件。 */
function fakeOrca(): {
  readonly orca: OrcaWorkerApi
  readonly handlers: Map<string, OrcaPanelRequestHandler>
  readonly posts: { readonly event: string; readonly payload: unknown }[]
} {
  const handlers = new Map<string, OrcaPanelRequestHandler>()
  const posts: { event: string; payload: unknown }[] = []
  const orca = {
    api: { major: 1, minor: 0 },
    commands: { register: () => ({ dispose: () => undefined }) },
    events: { on: () => ({ dispose: () => undefined }) },
    host: {
      call: async () => null,
      has: () => false,
    },
    panels: {
      handle: (name: string, handler: OrcaPanelRequestHandler) => {
        handlers.set(name, handler)
        return { dispose: () => undefined }
      },
      post: (event: string, payload?: unknown) => {
        posts.push({ event, payload })
      },
    },
    grantedCapabilities: [],
    log: () => undefined,
  } satisfies OrcaWorkerApi
  return { orca, handlers, posts }
}

/** 记录收到的参数。 */
function recordingServices(): {
  readonly snapshot: SnapshotService
  readonly ticket: TicketService
  readonly worktree: TicketWorktreeService
  readonly envCheck: EnvCheckService
  readonly avatar: AvatarService
  readonly skillCommand: SkillCommandService
  readonly seen: { method: string; params: unknown }[]
} {
  const seen: { method: string; params: unknown }[] = []
  const record = <T>(method: string, params: unknown): Promise<RpcResult<T>> => {
    seen.push({ method, params })
    return Promise.resolve({ ok: true, result: null as unknown as T })
  }
  return {
    seen,
    snapshot: {
      handle: (method, params) => record(method, params),
      cache: (params) => record(RPC_METHODS.snapshotCache, params),
    },
    ticket: { handle: (method, params) => record(method, params) },
    worktree: { handle: (method, params) => record(method, params) },
    envCheck: { handle: (method, params) => record(method, params) },
    avatar: { read: (params) => record('avatar.read', params) },
    skillCommand: {
      resolve: () => Promise.resolve({ style: 'claude' as const, source: 'default' as const }),
    },
  }
}

const log: LogSink = () => undefined

/** 一次面板请求的上下文：处理器只用到 signal。 */
const panelContext = {
  panel: { id: 'p', surface: 'panel' as const, contributionId: 'tickets' },
  signal: new AbortController().signal,
}

/** 两个同显示名、同分支的工作区：没有终端标题等额外线索时认领不到。 */
function ambiguousHost(): OrcaWorkerApi['host'] {
  return {
    async call(method: string) {
      if (method === 'workspace.readContext') return { displayName: 'main', branch: 'main' }
      if (method === 'workspace.list') {
        return {
          workspaces: [
            { id: '1', name: 'main', path: '/repo/a', branch: 'main', kind: 'worktree' },
            { id: '2', name: 'main', path: '/repo/b', branch: 'main', kind: 'worktree' },
          ],
          truncated: false,
        }
      }
      return null
    },
    has: () => true,
  }
}

beforeEach(() => {
  resetWorkspaceCandidatesReport()
})

describe('面板 RPC 桥', () => {
  it('每个 RPC 方法都注册了一个处理器', () => {
    const { orca, handlers } = fakeOrca()
    const services = recordingServices()

    registerRpcHandlers(orca, {
      snapshot: services.snapshot,
      ticket: services.ticket,
      worktree: services.worktree,
      envCheck: services.envCheck,
      avatar: services.avatar,
      skillCommand: services.skillCommand,
      workspace: createWorkspaceResolver(orca.host),
      log,
    })

    expect([...handlers.keys()]).toEqual(expect.arrayContaining([...Object.values(RPC_METHODS)]))
  })

  it('入池技能安装是独立的一个处理器', () => {
    const { orca, handlers } = fakeOrca()
    const services = recordingServices()

    registerRpcHandlers(orca, {
      snapshot: services.snapshot,
      ticket: services.ticket,
      worktree: services.worktree,
      envCheck: services.envCheck,
      avatar: services.avatar,
      skillCommand: services.skillCommand,
      workspace: createWorkspaceResolver(orca.host),
      log,
    })

    expect(handlers.has(SKILL_INSTALL_REQUEST)).toBe(true)
  })

  it('面板没给工作区时由 worker 解析后注入', async () => {
    const { orca, handlers } = fakeOrca()
    const services = recordingServices()
    const host = {
      call: async (method: string) => {
        if (method === 'workspace.readContext') return { displayName: 'feature-a', branch: 'a' }
        if (method === 'workspace.list') {
          return {
            workspaces: [
              { id: '1', name: 'feature-a', path: '/repo/a', branch: 'a', kind: 'worktree' },
            ],
            truncated: false,
          }
        }
        return null
      },
      has: () => true,
    }

    registerRpcHandlers(orca, {
      snapshot: services.snapshot,
      ticket: services.ticket,
      worktree: services.worktree,
      envCheck: services.envCheck,
      avatar: services.avatar,
      skillCommand: services.skillCommand,
      workspace: createWorkspaceResolver(host),
      log,
    })

    const handler = handlers.get(RPC_METHODS.snapshotGet)
    expect(handler).toBeDefined()
    await handler?.({ workspaceRoot: '' }, {
      panel: { id: 'p', surface: 'panel', contributionId: 'tickets' },
      signal: new AbortController().signal,
    })

    expect(services.seen).toHaveLength(1)
    expect(services.seen[0]?.method).toBe(RPC_METHODS.snapshotGet)
    expect(services.seen[0]?.params).toEqual({ workspaceRoot: '/repo/a' })
  })

  it('面板显式给了工作区时直接用它', async () => {
    const { orca, handlers } = fakeOrca()
    const services = recordingServices()

    registerRpcHandlers(orca, {
      snapshot: services.snapshot,
      ticket: services.ticket,
      worktree: services.worktree,
      envCheck: services.envCheck,
      avatar: services.avatar,
      skillCommand: services.skillCommand,
      workspace: createWorkspaceResolver(orca.host),
      log,
    })

    const handler = handlers.get(RPC_METHODS.ticketGet)
    await handler?.(
      { workspaceRoot: '/repo/picked', ref: '#1', number: 1 },
      {
        panel: { id: 'p', surface: 'panel', contributionId: 'tickets' },
        signal: new AbortController().signal,
      },
    )

    expect(services.seen[0]?.params).toEqual({ workspaceRoot: '/repo/picked', ref: '#1', number: 1 })
  })

  it('显式选择后，省略 workspaceRoot 的请求与刷新命令沿用同一工作区', async () => {
    const { orca, handlers } = fakeOrca()
    const services = recordingServices()
    const workspace = createWorkspaceResolver(ambiguousHost())

    registerRpcHandlers(orca, {
      snapshot: services.snapshot,
      ticket: services.ticket,
      worktree: services.worktree,
      envCheck: services.envCheck,
      avatar: services.avatar,
      skillCommand: services.skillCommand,
      workspace,
      log,
    })

    await handlers.get(RPC_METHODS.ticketGet)?.(
      { workspaceRoot: '/repo/b', ref: '#1', number: 1 },
      panelContext,
    )

    await handlers.get(RPC_METHODS.snapshotGet)?.({}, panelContext)
    expect(services.seen.at(-1)?.params).toEqual({ workspaceRoot: '/repo/b' })

    const refreshed = await refreshWorkspace(orca, {
      snapshot: services.snapshot,
      workspace,
      log,
    })
    expect(refreshed.ok).toBe(true)
    expect(services.seen.at(-1)?.method).toBe(RPC_METHODS.snapshotRefresh)
    expect(services.seen.at(-1)?.params).toEqual({ workspaceRoot: '/repo/b', full: true })
  })

  it('同一聚焦上下文下候选只推送一次', async () => {
    const { orca, handlers, posts } = fakeOrca()
    const services = recordingServices()
    const logs: unknown[] = []
    const recordingLog: LogSink = (level, event, fields) => {
      logs.push({ level, event, fields })
    }

    registerRpcHandlers(orca, {
      snapshot: services.snapshot,
      ticket: services.ticket,
      worktree: services.worktree,
      envCheck: services.envCheck,
      avatar: services.avatar,
      skillCommand: services.skillCommand,
      workspace: createWorkspaceResolver(ambiguousHost()),
      log: recordingLog,
    })

    const handler = handlers.get(RPC_METHODS.snapshotGet)
    const first = await handler?.({ workspaceRoot: '' }, panelContext)
    await handler?.({ workspaceRoot: '' }, panelContext)

    expect(first).toEqual({
      ok: false,
      error: { code: 'invalid-params', message: expect.stringContaining('面板顶部') },
    })
    const candidatePosts = posts.filter((post) => post.event === WORKSPACE_CANDIDATES_EVENT)
    expect(candidatePosts).toHaveLength(1)
    expect(candidatePosts[0]?.payload).toMatchObject({
      contextKey: 'main\u0000main',
      candidates: [
        { path: '/repo/a', branch: 'main' },
        { path: '/repo/b', branch: 'main' },
      ],
    })
    expect(logs).toHaveLength(1)
  })

  it('面板重载后仍能拿回候选：workspace.current 不依赖推送去重', async () => {
    const { orca, handlers } = fakeOrca()
    const services = recordingServices()

    registerRpcHandlers(orca, {
      snapshot: services.snapshot,
      ticket: services.ticket,
      worktree: services.worktree,
      envCheck: services.envCheck,
      avatar: services.avatar,
      skillCommand: services.skillCommand,
      workspace: createWorkspaceResolver(ambiguousHost()),
      log,
    })

    await handlers.get(RPC_METHODS.snapshotGet)?.({ workspaceRoot: '' }, panelContext)

    const current = await handlers.get(WORKSPACE_CURRENT_REQUEST)?.({}, panelContext)

    expect(current).toEqual({
      ok: true,
      result: {
        root: null,
        contextKey: 'main\u0000main',
        candidates: [
          {
            id: '1',
            name: 'main',
            path: '/repo/a',
            branch: 'main',
            project: '',
            kind: 'worktree',
          },
          {
            id: '2',
            name: 'main',
            path: '/repo/b',
            branch: 'main',
            project: '',
            kind: 'worktree',
          },
        ],
      },
    })
  })
})