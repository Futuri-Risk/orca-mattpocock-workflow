import { describe, expect, it, vi } from 'vitest'

import type {
  RpcErrorBody,
  RpcResult,
  TicketDetail,
  WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import { refreshTicket, type DetailRefreshHooks } from './ticket-detail-hooks.ts'
import {
  deferred,
  fail,
  makeDetail,
  makeSnapshot,
  makeTicket,
  ok,
} from './ticket-detail-test-support.ts'
import type { PanelClient } from './transport.ts'

const TARGET = { workspaceRoot: '/ws', ref: '#18', number: 18 }
const NOT_FOUND: RpcErrorBody = { code: 'ticket-not-found', message: '没有这张票' }

/** 只实现刷新用到的两个方法；其余入口由调用方保证不会走到。 */
function clientWith(overrides: {
  readonly getDetail: PanelClient['getDetail']
  readonly refresh: PanelClient['refresh']
}): PanelClient {
  return overrides as PanelClient
}

/** 收集三个落地回调。 */
function recorder(isCurrent: () => boolean = () => true): {
  readonly hooks: DetailRefreshHooks
  readonly details: TicketDetail[]
  readonly snapshots: WorkspaceSnapshot[]
  readonly errors: RpcErrorBody[]
} {
  const details: TicketDetail[] = []
  const snapshots: WorkspaceSnapshot[] = []
  const errors: RpcErrorBody[] = []
  return {
    hooks: {
      isCurrent,
      onDetail: (detail) => details.push(detail),
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onError: (error) => errors.push(error),
    },
    details,
    snapshots,
    errors,
  }
}

describe('工单详情刷新编排', () => {
  it('一次刷新各发一次读取与列表刷新，两者并行且详情先落地', async () => {
    const detail = deferred<RpcResult<TicketDetail>>()
    const snapshot = deferred<RpcResult<WorkspaceSnapshot>>()
    const getDetail = vi.fn(() => detail.promise)
    const refresh = vi.fn(() => snapshot.promise)
    const { hooks, details, snapshots, errors } = recorder()

    const run = refreshTicket(clientWith({ getDetail, refresh }), TARGET, hooks)

    expect(getDetail).toHaveBeenCalledTimes(1)
    expect(getDetail).toHaveBeenCalledWith('/ws', '#18', 18)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith('/ws')

    detail.resolve(ok(makeDetail({ title: '新标题' })))
    await Promise.resolve()
    expect(details.map((item) => item.title)).toEqual(['新标题'])
    expect(snapshots).toEqual([])

    snapshot.resolve(ok(makeSnapshot({ tickets: [makeTicket({ title: '新标题' })] })))
    await run
    expect(snapshots).toHaveLength(1)
    expect(errors).toEqual([])
  })

  it('详情刷新失败时给出原因，同时列表刷新照常落地', async () => {
    const detail = deferred<RpcResult<TicketDetail>>()
    const snapshot = deferred<RpcResult<WorkspaceSnapshot>>()
    const { hooks, details, snapshots, errors } = recorder()
    const run = refreshTicket(
      clientWith({
        getDetail: () => detail.promise,
        refresh: () => snapshot.promise,
      }),
      TARGET,
      hooks,
    )

    detail.resolve(fail(NOT_FOUND))
    snapshot.resolve(ok(makeSnapshot()))
    await run

    expect(details).toEqual([])
    expect(errors).toEqual([NOT_FOUND])
    expect(snapshots).toHaveLength(1)
  })

  it('列表刷新失败不产生详情错误，也不影响详情落地', async () => {
    const detail = deferred<RpcResult<TicketDetail>>()
    const snapshot = deferred<RpcResult<WorkspaceSnapshot>>()
    const { hooks, details, snapshots, errors } = recorder()
    const run = refreshTicket(
      clientWith({
        getDetail: () => detail.promise,
        refresh: () => snapshot.promise,
      }),
      TARGET,
      hooks,
    )

    snapshot.resolve(fail(NOT_FOUND))
    detail.resolve(ok(makeDetail({ title: '新标题' })))
    await run

    expect(snapshots).toEqual([])
    expect(errors).toEqual([])
    expect(details.map((item) => item.title)).toEqual(['新标题'])
  })

  it('目标已经切走后，在途结果一个都不落地', async () => {
    const detail = deferred<RpcResult<TicketDetail>>()
    const snapshot = deferred<RpcResult<WorkspaceSnapshot>>()
    let current = true
    const { hooks, details, snapshots, errors } = recorder(() => current)
    const run = refreshTicket(
      clientWith({
        getDetail: () => detail.promise,
        refresh: () => snapshot.promise,
      }),
      TARGET,
      hooks,
    )

    current = false
    detail.resolve(ok(makeDetail({ title: '旧结果' })))
    snapshot.resolve(ok(makeSnapshot({ tickets: [makeTicket()] })))
    await run

    expect(details).toEqual([])
    expect(snapshots).toEqual([])
    expect(errors).toEqual([])
  })
})
