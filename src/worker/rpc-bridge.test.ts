import { describe, expect, it } from 'vitest'

import { RPC_METHODS, type RpcResult } from '../protocol/tracker.ts'
import type { EnvCheckService } from './env-check-service.ts'
import type { LogSink } from './log.ts'
import type { OrcaPanelRequestHandler, OrcaWorkerApi } from './orca-types.ts'
import { registerRpcHandlers, SKILL_INSTALL_REQUEST } from './rpc-bridge.ts'
import type { SnapshotService } from './snapshot-service.ts'
import type { TicketService } from './ticket-service.ts'
import { createWorkspaceResolver } from './workspace-resolver.ts'

/** 收集注册下来的面板处理器。 */
function fakeOrca(): {
  readonly orca: OrcaWorkerApi
  readonly handlers: Map<string, OrcaPanelRequestHandler>
} {
  const handlers = new Map<string, OrcaPanelRequestHandler>()
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
      post: () => undefined,
    },
    grantedCapabilities: [],
    log: () => undefined,
  } satisfies OrcaWorkerApi
  return { orca, handlers }
}

/** 记录收到的参数。 */
function recordingServices(): {
  readonly snapshot: SnapshotService
  readonly ticket: TicketService
  readonly envCheck: EnvCheckService
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
    envCheck: { handle: (method, params) => record(method, params) },
  }
}

const log: LogSink = () => undefined

describe('面板 RPC 桥', () => {
  it('每个 RPC 方法都注册了一个处理器', () => {
    const { orca, handlers } = fakeOrca()
    const services = recordingServices()

    registerRpcHandlers(orca, {
      snapshot: services.snapshot,
      ticket: services.ticket,
      envCheck: services.envCheck,
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
      envCheck: services.envCheck,
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
      envCheck: services.envCheck,
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
      envCheck: services.envCheck,
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
})