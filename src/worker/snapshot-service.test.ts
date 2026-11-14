import { describe, expect, it } from 'vitest'

import type { SnapshotStore } from '../adapters/fs/snapshot-store.ts'
import { SNAPSHOT_STORE_VERSION, type SnapshotStoreEntry } from '../core/snapshot-store.ts'
import type { SnapshotPage, Ticket, Tracker, TrackerChanges, TrackerSnapshot } from '../core/ticket.ts'
import { TrackerError } from '../core/tracker-error.ts'
import type { BackendChoice } from '../core/backend.ts'
import { TRACKER_LABELS } from '../protocol/labels.ts'
import { RPC_METHODS, type RpcResult, type WorkspaceSnapshot } from '../protocol/tracker.ts'
import type { ResolvedBackend } from './backend-resolver.ts'
import { createSnapshotService } from './snapshot-service.ts'

const NOW = 1_700_000_000_000
const ROOT = '/workspace'
const CHOICE: BackendChoice = { kind: 'github', source: 'remote' }

function ticket(number: number, overrides: Partial<Ticket> = {}): Ticket {
  return {
    ref: `#${String(number)}`,
    number,
    title: `票 ${String(number)}`,
    state: 'open',
    labels: [],
    author: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: `2026-11-${String(Math.min(number, 28)).padStart(2, '0')}T00:00:00Z`,
    openBlockers: 0,
    ...overrides,
  }
}

function page(
  tickets: readonly Ticket[],
  options: { readonly total?: number; readonly nextCursor?: string } = {},
): TrackerSnapshot {
  const nextCursor = options.nextCursor
  return {
    repository: 'cnzgray/repo',
    fetchedAt: NOW,
    loaded: tickets.length,
    total: options.total ?? tickets.length,
    tickets,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  }
}

interface PagedTracker {
  readonly tracker: Tracker
  /** 每次拉取收到的游标；undefined 表示第一页。 */
  readonly calls: (string | undefined)[]
  /** 每次增量拉取收到的窗口起点。 */
  readonly changeCalls: number[]
}

/**
 * 按游标回放的假后端：`pages` 的键是游标，空串是第一页。
 * @param pages - 各页的响应。
 * @param changes - 给出时实现增量能力，按窗口起点返回变更。
 * @returns 后端、列表调用记录与增量调用记录。
 */
function pagedTracker(
  pages: ReadonlyMap<string, TrackerSnapshot>,
  changes?: (since: number) => TrackerChanges,
): PagedTracker {
  const calls: (string | undefined)[] = []
  const changeCalls: number[] = []
  const tracker: Tracker = {
    fetchSnapshot(_root: string, request?: SnapshotPage): Promise<TrackerSnapshot> {
      calls.push(request?.cursor)
      const found = pages.get(request?.cursor ?? '')
      if (found === undefined) {
        return Promise.reject(new TrackerError('fetch-failed', '没有这一页'))
      }
      return Promise.resolve(found)
    },
    ...(changes === undefined
      ? {}
      : {
          fetchChanges(_root: string, since: number): Promise<TrackerChanges> {
            changeCalls.push(since)
            return Promise.resolve(changes(since))
          },
        }),
  }
  return { tracker, calls, changeCalls }
}

/** 内存快照库：只实现快照服务用到的方法。 */
function memoryStore(): SnapshotStore & { readonly entries: Map<string, SnapshotStoreEntry> } {
  const entries = new Map<string, SnapshotStoreEntry>()
  return {
    entries,
    read: (workspaceRoot) => Promise.resolve(entries.get(workspaceRoot)),
    write: (entry) => {
      entries.set(entry.workspaceRoot, entry)
      return Promise.resolve()
    },
    remove: (workspaceRoot) => {
      entries.delete(workspaceRoot)
      return Promise.resolve()
    },
    list: () => Promise.resolve([...entries.values()]),
    clear: () => {
      const count = entries.size
      entries.clear()
      return Promise.resolve(count)
    },
    prune: () => Promise.resolve(0),
    patchTicket: () => Promise.resolve(false),
    removeTicket: () => Promise.resolve(false),
    location: () => '~/.orca-mattpocock-workflow/cache',
  }
}

/** 本地快照库里的一个分页窗口条目；默认不带游标，模拟旧版本写下的缓存。 */
function storeEntry(overrides: Partial<SnapshotStoreEntry> = {}): SnapshotStoreEntry {
  return {
    version: SNAPSHOT_STORE_VERSION,
    workspaceRoot: ROOT,
    backend: 'github',
    repository: 'cnzgray/repo',
    repositoryKey: 'github@github.com/cnzgray/repo',
    repositoryHost: 'github.com',
    fetchedAt: NOW - 60_000,
    loaded: 2,
    total: 6,
    tickets: [ticket(5), ticket(4)],
    ...overrides,
  }
}

function service(
  tracker: Tracker,
  store: SnapshotStore = memoryStore(),
  now: () => number = () => NOW,
) {
  const resolved: ResolvedBackend = {
    kind: 'github',
    tracker,
    choice: CHOICE,
    address: { host: 'github.com', path: 'cnzgray/repo' },
  }
  return createSnapshotService({
    resolve: () => Promise.resolve(resolved),
    now,
    labels: TRACKER_LABELS,
    log: () => {},
    store,
  })
}

function resultOf(result: RpcResult<WorkspaceSnapshot>): WorkspaceSnapshot {
  if (!result.ok) throw new Error(`预期成功，实际失败：${result.error.message}`)
  return result.result
}

function refs(snapshot: WorkspaceSnapshot): string[] {
  return snapshot.tickets.map((item) => item.ref)
}

describe('快照分页', () => {
  it('首屏只取第一页，并说明还有更多', async () => {
    const { tracker } = pagedTracker(
      new Map([['', page([ticket(5), ticket(4)], { total: 6, nextCursor: 'cursor-2' })]]),
    )
    const snapshot = resultOf(await service(tracker).handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT }))

    expect(snapshot.loaded).toBe(2)
    expect(snapshot.total).toBe(6)
    expect(snapshot.hasMore).toBe(true)
    expect(refs(snapshot)).toEqual(['#5', '#4'])
  })

  it('加载更多按游标追加，直到覆盖全部', async () => {
    const { tracker, calls } = pagedTracker(
      new Map([
        ['', page([ticket(5), ticket(4)], { total: 5, nextCursor: 'cursor-2' })],
        [
          'cursor-2',
          page([ticket(3), ticket(2)], { total: 5, nextCursor: 'cursor-3' }),
        ],
        ['cursor-3', page([ticket(1)], { total: 5 })],
      ]),
    )
    const snapshots = service(tracker)
    await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT })

    const second = resultOf(await snapshots.handle(RPC_METHODS.snapshotLoadMore, { workspaceRoot: ROOT }))
    expect(second.loaded).toBe(4)
    expect(second.hasMore).toBe(true)

    const third = resultOf(await snapshots.handle(RPC_METHODS.snapshotLoadMore, { workspaceRoot: ROOT }))
    expect(third.loaded).toBe(5)
    expect(third.hasMore).toBe(false)
    expect(refs(third)).toEqual(['#5', '#4', '#3', '#2', '#1'])

    // 已经覆盖全部：再点一次原样返回，不再请求后端。
    const again = resultOf(await snapshots.handle(RPC_METHODS.snapshotLoadMore, { workspaceRoot: ROOT }))
    expect(again.loaded).toBe(5)
    expect(calls).toEqual([undefined, 'cursor-2', 'cursor-3'])
  })

  it('重复出现的票按引用去重，取更新的一份', async () => {
    const updated = ticket(4, { updatedAt: '2026-11-20T00:00:00Z', title: '改过标题' })
    const { tracker } = pagedTracker(
      new Map([
        ['', page([ticket(5), ticket(4)], { total: 5, nextCursor: 'cursor-2' })],
        ['cursor-2', page([updated, ticket(3)], { total: 5 })],
      ]),
    )
    const snapshots = service(tracker)
    await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT })

    const snapshot = resultOf(await snapshots.handle(RPC_METHODS.snapshotLoadMore, { workspaceRoot: ROOT }))

    expect(refs(snapshot)).toEqual(['#5', '#4', '#3'])
    expect(snapshot.tickets.find((item) => item.ref === '#4')?.title).toBe('改过标题')
  })

  it('一次取全的后端没有游标，加载更多直接返回当前快照', async () => {
    const { tracker, calls } = pagedTracker(new Map([['', page([ticket(1)])]]))
    const snapshots = service(tracker)
    const first = resultOf(await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT }))

    const again = resultOf(await snapshots.handle(RPC_METHODS.snapshotLoadMore, { workspaceRoot: ROOT }))

    expect(first.hasMore).toBe(false)
    expect(again.loaded).toBe(1)
    expect(calls).toEqual([undefined])
  })

  it('取下一页失败时保留已加载的列表并记下原因', async () => {
    const { tracker } = pagedTracker(
      new Map([['', page([ticket(5)], { total: 2, nextCursor: 'cursor-2' })]]),
    )
    const snapshots = service(tracker)
    await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT })

    const failed = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotLoadMore, { workspaceRoot: ROOT }),
    )

    expect(failed.loaded).toBe(1)
    expect(failed.hasMore).toBe(true)
    expect(failed.refreshError).toMatchObject({ code: 'fetch-failed' })
    expect(failed.tickets.map((item) => item.ref)).toEqual(['#5'])
  })

  it('仓库换了之后加载更多会重建快照，不混入旧仓库的票', async () => {
    const store = memoryStore()
    const oldTracker = pagedTracker(
      new Map([['', page([ticket(5)], { total: 2, nextCursor: 'cursor-2' })]]),
    )
    const newTracker = pagedTracker(new Map([['', page([ticket(9)], { total: 1 })]]))
    let tracker = oldTracker.tracker
    let path = 'cnzgray/repo'
    const snapshots = createSnapshotService({
      resolve: () =>
        Promise.resolve({
          kind: 'github',
          tracker,
          choice: CHOICE,
          address: { host: 'github.com', path },
        }),
      now: () => NOW,
      labels: TRACKER_LABELS,
      log: () => {},
      store,
    })
    await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT })

    // 用户把远端换成了另一个仓库：下一次解析返回新的身份。
    tracker = newTracker.tracker
    path = 'cnzgray/other'
    const snapshot = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotLoadMore, { workspaceRoot: ROOT }),
    )

    expect(refs(snapshot)).toEqual(['#9'])
    expect(snapshot.hasMore).toBe(false)
    expect(newTracker.calls).toEqual([undefined])
  })
})

describe('快照分页持久化', () => {
  it('追加的进度写进本地快照库，重启后能接着加载', async () => {
    const store = memoryStore()
    const { tracker } = pagedTracker(
      new Map([
        ['', page([ticket(5), ticket(4)], { total: 5, nextCursor: 'cursor-2' })],
        ['cursor-2', page([ticket(3)], { total: 5, nextCursor: 'cursor-3' })],
      ]),
    )
    const snapshots = service(tracker, store)
    await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT })
    await snapshots.handle(RPC_METHODS.snapshotLoadMore, { workspaceRoot: ROOT })

    const stored = store.entries.get(ROOT)
    expect(stored?.tickets.map((item) => item.ref)).toEqual(['#5', '#4', '#3'])
    expect(stored?.nextCursor).toBe('cursor-3')
  })

  it('窗口没有游标的旧缓存改走全量重拉，升级后也能继续加载', async () => {
    const store = memoryStore()
    store.entries.set(ROOT, storeEntry())
    const { tracker, calls, changeCalls } = pagedTracker(
      new Map([['', page([ticket(5), ticket(4)], { total: 6, nextCursor: 'cursor-2' })]]),
      () => ({ tickets: [], truncated: false }),
    )

    const snapshot = resultOf(
      await service(tracker, store).handle(RPC_METHODS.snapshotRefresh, { workspaceRoot: ROOT }),
    )

    expect(changeCalls).toEqual([])
    expect(calls).toEqual([undefined])
    expect(snapshot.hasMore).toBe(true)
    expect(snapshot.loaded).toBe(2)
    expect(store.entries.get(ROOT)?.nextCursor).toBe('cursor-2')
  })

  it('增量刷新保留已追加的窗口，游标不会跨过被裁掉的票', async () => {
    const store = memoryStore()
    store.entries.set(
      ROOT,
      storeEntry({
        loaded: 3,
        total: 6,
        nextCursor: 'cursor-3',
        tickets: [ticket(6), ticket(5), ticket(4)],
      }),
    )
    const { tracker, calls } = pagedTracker(new Map(), () => ({
      // 窗口外的一张票被更新：它现在属于最前面，必须保留，尾部也不能裁。
      tickets: [ticket(1, { updatedAt: '2026-11-21T00:00:00Z' })],
      truncated: false,
      total: 6,
    }))

    const snapshot = resultOf(
      await service(tracker, store).handle(RPC_METHODS.snapshotRefresh, { workspaceRoot: ROOT }),
    )

    expect(calls).toEqual([])
    expect(refs(snapshot)).toEqual(['#6', '#5', '#4', '#1'])
    expect(snapshot.hasMore).toBe(true)
    expect(store.entries.get(ROOT)?.nextCursor).toBe('cursor-3')
  })
})
