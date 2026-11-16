import { describe, expect, it } from 'vitest'

import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import type { TicketSnapshot, WorkspaceSnapshot } from '../protocol/tracker.ts'
import { createPanelClient } from './transport.ts'

function ticket(overrides: Partial<TicketSnapshot> = {}): TicketSnapshot {
  return {
    ref: '#1',
    number: 1,
    title: '一张票',
    state: 'open',
    category: null,
    status: 'open',
    labels: [],
    author: null,
    assignees: [],
    skillAction: 'none',
    skillActionReason: 'untriaged',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-02T00:00:00Z',
    openBlockers: 0,
    ...overrides,
  }
}

function snapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    backend: 'github',
    repository: 'o/r',
    repositoryHost: 'github.com',
    fetchedAt: 1,
    viewer: 'cnzgray',
    loaded: 1,
    total: 1,
    hasMore: false,
    tickets: [ticket()],
    metrics: emptyMetrics(),
    blockersFinalized: true,
    source: 'live',
    stale: false,
    refreshError: null,
    ...overrides,
  }
}

function clientFor(result: unknown) {
  return createPanelClient(() => Promise.resolve({ ok: true, result }))
}

describe('快照响应校验', () => {
  it('接受带当前用户与分配人的快照', async () => {
    const response = await clientFor(snapshot()).get('/ws')

    expect(response.ok).toBe(true)
  })

  it('缺少 viewer 时按 fetch-failed 处理', async () => {
    const value = snapshot()
    const withoutViewer = { ...value } as Record<string, unknown>
    delete withoutViewer.viewer

    const response = await clientFor(withoutViewer).get('/ws')

    expect(response).toMatchObject({ ok: false, error: { code: 'fetch-failed' } })
  })

  it('viewer 不是字符串或 null 时拒绝', async () => {
    const response = await clientFor(snapshot({ viewer: 42 as unknown as string })).get('/ws')

    expect(response).toMatchObject({ ok: false, error: { code: 'fetch-failed' } })
  })

  it('某张票缺少 assignees 时拒绝', async () => {
    const value = snapshot()
    const withoutAssignees = { ...value.tickets[0] } as Record<string, unknown>
    delete withoutAssignees.assignees

    const response = await clientFor(snapshot({ tickets: [withoutAssignees as never] })).get(
      '/ws',
    )

    expect(response).toMatchObject({ ok: false, error: { code: 'fetch-failed' } })
  })

  it('assignees 不是字符串数组时拒绝', async () => {
    const response = await clientFor(
      snapshot({ tickets: [ticket({ assignees: [1 as unknown as string] })] }),
    ).get('/ws')

    expect(response).toMatchObject({ ok: false, error: { code: 'fetch-failed' } })
  })
})
