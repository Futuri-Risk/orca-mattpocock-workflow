/**
 * 工单详情用例的共用夹具：快照行、详情、工作区快照与可控 promise。
 *
 * 生产代码不导入这个文件；各测试按需覆盖字段，避免每处手写整份协议对象。
 */
import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import type {
  RpcErrorBody,
  RpcResult,
  SnapshotRefreshResult,
  TicketDetail,
  TicketSnapshot,
  WorkspaceSnapshot,
} from '../protocol/tracker.ts'

/** 一张可开工的列表行。 */
export function makeTicket(overrides: Partial<TicketSnapshot> = {}): TicketSnapshot {
  return {
    ref: '#18',
    number: 18,
    title: 'Ticket 18',
    state: 'open',
    category: null,
    status: 'ready',
    labels: [],
    author: null,
    assignees: [],
    skillAction: 'implement',
    skillActionReason: 'ready-for-agent',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    openBlockers: 0,
    ...overrides,
  }
}

/** 一份完整的工单详情。 */
export function makeDetail(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    ref: '#18',
    number: 18,
    title: 'Ticket 18',
    state: 'open',
    author: null,
    body: 'Body',
    labels: [],
    assignees: [],
    comments: [],
    url: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    backend: 'markdown',
    capabilities: {
      labels: false,
      assignees: false,
      state: false,
      link: false,
      delete: false,
    },
    ...overrides,
  }
}

/** 一个工作区快照；票数与总数默认跟着 `tickets` 走。 */
export function makeSnapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  const tickets = overrides.tickets ?? []
  return {
    backend: 'github',
    repository: 'acme/repo',
    repositoryHost: 'github.com',
    fetchedAt: 1_700_000_000_000,
    viewer: 'me',
    loaded: tickets.length,
    total: tickets.length,
    hasMore: false,
    tickets,
    hierarchy: 'none',
    metrics: emptyMetrics(),
    blockersFinalized: true,
    source: 'live',
    stale: false,
    refreshError: null,
    revision: null,
    storeRevision: 0,
    ...overrides,
  }
}

/** 成功响应。 */
export function ok<T>(result: T): RpcResult<T> {
  return { ok: true, result }
}

/** 整份快照的刷新回包。 */
export function full(snapshot: WorkspaceSnapshot): SnapshotRefreshResult {
  return { kind: 'snapshot', snapshot }
}

/** 失败响应。 */
export function fail<T>(error: RpcErrorBody): RpcResult<T> {
  return { ok: false, error }
}

/** 手动控制落地时机的 promise。 */
export interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
}

/** 建一个尚未结算的 promise。 */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}
