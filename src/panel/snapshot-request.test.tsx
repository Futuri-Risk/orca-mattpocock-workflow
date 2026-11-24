// @vitest-environment happy-dom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import type {
  RpcResult,
  SnapshotDelta,
  SnapshotRefreshResult,
  WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import {
  find,
  mustFind,
  render,
  setupDom,
  settle,
  teardownDom,
} from './dom-test-support.ts'
import {
  applyRefreshResult,
  applySnapshotDelta,
  useSnapshotRequest,
  type SnapshotRequestState,
} from './snapshot-request.ts'
import {
  deferred,
  full,
  makeSnapshot,
  makeTicket,
  ok,
} from './ticket-detail-test-support.ts'
import type { PanelClient } from './transport.ts'

const WORKSPACE = '/ws'

beforeEach(() => {
  setupDom()
})

afterEach(async () => {
  await teardownDom()
})

function delta(overrides: Partial<SnapshotDelta> = {}): SnapshotDelta {
  return {
    kind: 'delta',
    backend: 'github',
    repository: 'acme/repo',
    repositoryHost: 'github.com',
    revision: 'r2',
    storeRevision: 2,
    fetchedAt: 2_000,
    viewer: 'me',
    loaded: 1,
    total: 1,
    hasMore: false,
    hierarchy: 'none',
    metrics: emptyMetrics(),
    blockersFinalized: true,
    source: 'live',
    stale: false,
    refreshError: null,
    changed: [],
    removed: [],
    ...overrides,
  }
}

function clientWith(overrides: Partial<PanelClient>): PanelClient {
  return overrides as PanelClient
}

/** 把 hook 的最新状态渲染成可查询的文本。 */
function Probe(props: {
  readonly client: PanelClient
  readonly workspaceRoot: string
  readonly onState: (state: SnapshotRequestState) => void
}): React.ReactElement {
  const state = useSnapshotRequest(props.client, props.workspaceRoot)
  props.onState(state)
  return (
    <div>
      <span data-testid="titles">
        {(state.snapshot?.tickets ?? []).map((ticket) => ticket.title).join(',')}
      </span>
      <span data-testid="fetched-at">{String(state.snapshot?.fetchedAt ?? '')}</span>
      <span data-testid="phase">{state.phase}</span>
    </div>
  )
}

describe('applySnapshotDelta', () => {
  it('按引用替换变化行、移除墓碑、把新行接在末尾', () => {
    const current = makeSnapshot({
      tickets: [
        makeTicket({ ref: '#1', number: 1, title: '一' }),
        makeTicket({ ref: '#2', number: 2, title: '二' }),
        makeTicket({ ref: '#3', number: 3, title: '三' }),
      ],
    })

    const merged = applySnapshotDelta(
      current,
      delta({
        changed: [
          makeTicket({ ref: '#2', number: 2, title: '二改' }),
          makeTicket({ ref: '#4', number: 4, title: '四' }),
        ],
        removed: ['#3'],
        loaded: 3,
        total: 3,
      }),
    )

    expect(merged.tickets.map((ticket) => ticket.title)).toEqual(['一', '二改', '四'])
    expect(merged.fetchedAt).toBe(2_000)
    expect(merged.storeRevision).toBe(2)
  })

  it('not-modified 保留行数据但标成已核验的最新', () => {
    const current = makeSnapshot({
      fetchedAt: 1_000,
      source: 'cache',
      stale: true,
      refreshError: { code: 'fetch-failed', message: '上一轮失败' },
    })

    const verified = applyRefreshResult(current, {
      kind: 'not-modified',
      revision: 'r1',
      storeRevision: 2,
      fetchedAt: 2_000,
    })

    expect(verified?.tickets).toBe(current.tickets)
    expect(verified).toMatchObject({
      source: 'live',
      stale: false,
      refreshError: null,
      fetchedAt: 2_000,
      revision: 'r1',
      storeRevision: 2,
    })
  })
})

describe('useSnapshotRequest', () => {
  it('首屏先显示缓存，后台增量刷新只合并变化行', async () => {
    const cached = makeSnapshot({
      fetchedAt: 1_000,
      source: 'cache',
      stale: true,
      revision: 'r1',
      storeRevision: 1,
      tickets: [makeTicket({ title: '旧标题' })],
    })
    const updated = makeTicket({ title: '新标题' })
    const get = vi.fn<PanelClient['get']>(async () => ok(cached))
    const refresh = vi.fn<PanelClient['refresh']>(async () =>
      ok(delta({ changed: [updated] })),
    )
    const seen: SnapshotRequestState[] = []
    await render(
      <Probe
        client={clientWith({ get, refresh })}
        workspaceRoot={WORKSPACE}
        onState={(next) => {
          seen.push(next)
        }}
      />,
    )
    await settle()

    expect(refresh).toHaveBeenCalledWith(WORKSPACE, {
      storeRevision: 1,
    })
    expect(mustFind('titles').textContent).toBe('新标题')
    expect(mustFind('fetched-at').textContent).toBe('2000')
    expect(seen.at(-1)?.phase).toBe('ready')
  })

  it('not-modified 时列表不动，但清掉陈旧标记并推进核对时刻', async () => {
    const cached = makeSnapshot({
      fetchedAt: 1_000,
      source: 'cache',
      stale: true,
      revision: 'r1',
      storeRevision: 1,
      tickets: [makeTicket({ title: '缓存标题' })],
    })
    const seen: SnapshotRequestState[] = []
    const get = vi.fn<PanelClient['get']>(async () => ok(cached))
    const refresh = vi.fn<PanelClient['refresh']>(async () =>
      ok({
        kind: 'not-modified',
        revision: 'r1',
        storeRevision: 1,
        fetchedAt: 2_000,
      } satisfies SnapshotRefreshResult),
    )
    await render(
      <Probe
        client={clientWith({ get, refresh })}
        workspaceRoot={WORKSPACE}
        onState={(next) => {
          seen.push(next)
        }}
      />,
    )
    await settle()

    expect(find('titles')?.textContent).toBe('缓存标题')
    expect(find('fetched-at')?.textContent).toBe('2000')
    expect(seen.at(-1)?.snapshot?.stale).toBe(false)
    expect(seen.at(-1)?.snapshot?.source).toBe('live')
  })

  it('delta 未定稿时自动补齐阻塞信息并落地定稿结果', async () => {
    const cached = makeSnapshot({
      fetchedAt: 1_000,
      source: 'cache',
      revision: 'r1',
      storeRevision: 1,
      blockersFinalized: true,
      tickets: [makeTicket({ title: '缓存标题' })],
    })
    const changed = makeTicket({ title: '变化行' })
    const finalized = makeSnapshot({
      fetchedAt: 2_000,
      revision: 'r2',
      storeRevision: 2,
      blockersFinalized: true,
      tickets: [makeTicket({ title: '补齐后' })],
    })
    const get = vi.fn<PanelClient['get']>(async () => ok(cached))
    const refresh = vi.fn<PanelClient['refresh']>(async () =>
      ok(delta({ changed: [changed], blockersFinalized: false })),
    )
    const resolveBlockers = vi.fn<PanelClient['resolveBlockers']>(async () => ok(finalized))
    await render(
      <Probe
        client={clientWith({ get, refresh, resolveBlockers })}
        workspaceRoot={WORKSPACE}
        onState={() => {}}
      />,
    )
    await settle()

    expect(resolveBlockers).toHaveBeenCalledTimes(1)
    expect(find('titles')?.textContent).toBe('补齐后')
  })

  it('切换工作区后，旧工作区还在路上的 delta 不写进新工作区', async () => {
    const firstGet = deferred<RpcResult<WorkspaceSnapshot>>()
    const staleRefresh = deferred<RpcResult<SnapshotRefreshResult>>()
    const cachedB = makeSnapshot({
      repository: 'acme/other',
      fetchedAt: 3_000,
      revision: 'rb',
      storeRevision: 1,
      tickets: [makeTicket({ title: 'B 票' })],
    })
    let calls = 0
    const get = vi.fn<PanelClient['get']>(async () => {
      calls += 1
      if (calls === 1) return firstGet.promise
      return ok(cachedB)
    })
    const refresh = vi.fn<PanelClient['refresh']>(async () => staleRefresh.promise)
    const client = clientWith({ get, refresh })
    await render(<Probe client={client} workspaceRoot="/a" onState={() => {}} />)
    await settleWithDeferred(
      firstGet,
      ok(makeSnapshot({ source: 'cache', stale: true, tickets: [makeTicket({ title: 'A 票' })] })),
    )
    await settle()

    await render(<Probe client={client} workspaceRoot="/b" onState={() => {}} />)
    await settleWithDeferred(
      staleRefresh,
      ok(full(makeSnapshot({ tickets: [makeTicket({ title: 'A 旧刷新' })] }))),
    )
    await settle()

    expect(find('titles')?.textContent).toBe('B 票')
  })
})

/** 在 act 里结算一个 deferred，让 React 处理完对应更新。 */
async function settleWithDeferred<T>(target: { resolve(value: T): void }, value: T): Promise<void> {
  await React.act(async () => {
    target.resolve(value)
    await Promise.resolve()
  })
}
