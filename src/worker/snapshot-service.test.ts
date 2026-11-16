import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createNodeSnapshotStore, type SnapshotStore } from '../adapters/fs/snapshot-store.ts'
import { storeKeyOf } from '../core/repository-scope.ts'
import { SNAPSHOT_STORE_VERSION, type SnapshotStoreEntry } from '../core/snapshot-store.ts'
import type {
  SnapshotPage,
  Ticket,
  TicketPatch,
  TicketReference,
  Tracker,
  TrackerChanges,
  TrackerSnapshot,
} from '../core/ticket.ts'
import { TrackerError } from '../core/tracker-error.ts'
import type { BackendChoice } from '../core/backend.ts'
import { TRACKER_LABELS } from '../protocol/labels.ts'
import {
  RPC_METHODS,
  TICKET_DELETE_CONFIRMATION,
  type RpcResult,
  type WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import type { ResolvedBackend } from './backend-resolver.ts'
import { createSnapshotService } from './snapshot-service.ts'
import { createTicketService } from './ticket-service.ts'

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
    assignees: [],
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: `2026-11-${String(Math.min(number, 28)).padStart(2, '0')}T00:00:00Z`,
    openBlockers: 0,
    ...overrides,
  }
}

function page(
  tickets: readonly Ticket[],
  options: {
    readonly total?: number
    readonly nextCursor?: string
    readonly viewer?: string | null
  } = {},
): TrackerSnapshot {
  const nextCursor = options.nextCursor
  return {
    repository: 'cnzgray/repo',
    fetchedAt: NOW,
    loaded: tickets.length,
    total: options.total ?? tickets.length,
    tickets,
    viewer: options.viewer ?? null,
    hierarchy: 'native',
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
    read: (key) => Promise.resolve(entries.get(key)),
    write: (entry) => {
      entries.set(storeKeyOf(entry.backend, entry.scopeRoot, entry.workspaceRoot), entry)
      return Promise.resolve()
    },
    remove: (key) => {
      entries.delete(key)
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
    scopeRoot: ROOT,
    workspaceRoot: ROOT,
    backend: 'github',
    repository: 'cnzgray/repo',
    repositoryKey: 'github@github.com/cnzgray/repo',
    repositoryHost: 'github.com',
    fetchedAt: NOW - 60_000,
    viewer: 'cnzgray',
    loaded: 2,
    total: 6,
    tickets: [ticket(5), ticket(4)],
    hierarchy: 'native',
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
    scope: (workspaceRoot) => Promise.resolve(workspaceRoot),
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

  it('快照带父子能力与父级引用，加载更多后仍在', async () => {
    const { tracker } = pagedTracker(
      new Map([
        ['', page([ticket(5, { parent: '#1' }), ticket(4)], { total: 3, nextCursor: 'cursor-2' })],
        ['cursor-2', page([ticket(3)], { total: 3 })],
      ]),
    )
    const snapshots = service(tracker)
    const first = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT }),
    )

    expect(first.hierarchy).toBe('native')
    expect(first.tickets.find((item) => item.ref === '#5')?.parent).toBe('#1')

    const more = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotLoadMore, { workspaceRoot: ROOT }),
    )

    expect(more.hierarchy).toBe('native')
    expect(more.tickets.find((item) => item.ref === '#5')?.parent).toBe('#1')
  })

  it('后端取不到层级时快照标为无父子能力，列表仍然成功', async () => {
    const { tracker } = pagedTracker(
      new Map([['', { ...page([ticket(1)]), hierarchy: 'none' as const }]]),
    )

    const snapshot = resultOf(
      await service(tracker).handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT }),
    )

    expect(snapshot.hierarchy).toBe('none')
    expect(refs(snapshot)).toEqual(['#1'])
  })

  it('阻塞补齐重建快照后父子能力与父级引用仍在', async () => {
    const pageTracker = pagedTracker(
      new Map([['', page([ticket(5, { parent: '#9' }), ticket(4)], { total: 2 })]]),
    )
    const tracker: Tracker = {
      ...pageTracker.tracker,
      resolveBlockers: () =>
        Promise.resolve({ open: new Map([['#5', 0]]), blockedBy: new Map() }),
    }
    const snapshots = service(tracker)
    const first = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT }),
    )
    expect(first.blockersFinalized).toBe(false)

    const settled = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotResolveBlockers, { workspaceRoot: ROOT }),
    )

    expect(settled.hierarchy).toBe('native')
    expect(settled.tickets.find((item) => item.ref === '#5')?.parent).toBe('#9')
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
      scope: (workspaceRoot) => Promise.resolve(workspaceRoot),
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

  it('父子能力与父级引用随缓存进出，缓存首屏直接可用', async () => {
    const store = memoryStore()
    const online = service(
      pagedTracker(
        new Map([['', page([ticket(5, { parent: '#4' }), ticket(4)], { total: 2 })]]),
      ).tracker,
      store,
    )
    await online.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT })

    const stored = store.entries.get(ROOT)
    expect(stored?.hierarchy).toBe('native')
    expect(stored?.tickets.find((item) => item.ref === '#5')?.parent).toBe('#4')

    // 新进程：后端不可用也不能阻止首屏读缓存。
    const offline = service(
      {
        fetchSnapshot: () => Promise.reject(new TrackerError('fetch-failed', '离线')),
      },
      store,
    )
    const cached = resultOf(
      await offline.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT }),
    )

    expect(cached.source).toBe('cache')
    expect(cached.hierarchy).toBe('native')
    expect(cached.tickets.find((item) => item.ref === '#5')?.parent).toBe('#4')
  })

  it('增量父子能力与库里不一致时退回全量重拉', async () => {
    const store = memoryStore()
    store.entries.set(
      ROOT,
      storeEntry({ loaded: 1, total: 1, tickets: [ticket(5)] }),
    )
    const { tracker, calls, changeCalls } = pagedTracker(
      new Map([['', page([ticket(5, { parent: '#4' }), ticket(4)], { total: 2 })]]),
      () => ({ tickets: [ticket(5, { title: '只取到半棵树' })], truncated: false, hierarchy: 'none' }),
    )

    const snapshot = resultOf(
      await service(tracker, store).handle(RPC_METHODS.snapshotRefresh, { workspaceRoot: ROOT }),
    )

    expect(changeCalls).toHaveLength(1)
    expect(calls).toEqual([undefined])
    expect(snapshot.hierarchy).toBe('native')
    expect(refs(snapshot)).toEqual(['#5', '#4'])
  })

  it('父子能力一致时增量保留未变更票的父级引用', async () => {
    const store = memoryStore()
    store.entries.set(
      ROOT,
      storeEntry({
        loaded: 1,
        total: 1,
        tickets: [ticket(5, { parent: '#9' })],
      }),
    )
    const { tracker, changeCalls } = pagedTracker(
      new Map(),
      () => ({
        tickets: [ticket(6)],
        truncated: false,
        total: 2,
        hierarchy: 'native',
      }),
    )

    const snapshot = resultOf(
      await service(tracker, store).handle(RPC_METHODS.snapshotRefresh, { workspaceRoot: ROOT }),
    )

    expect(changeCalls).toHaveLength(1)
    expect(snapshot.hierarchy).toBe('native')
    expect(snapshot.tickets.find((item) => item.ref === '#5')?.parent).toBe('#9')
    expect(snapshot.tickets.find((item) => item.ref === '#6')?.parent).toBeUndefined()
  })

  it('窗口没有游标的旧缓存改走全量重拉，升级后也能继续加载', async () => {
    const store = memoryStore()
    store.entries.set(ROOT, storeEntry())
    const { tracker, calls, changeCalls } = pagedTracker(
      new Map([['', page([ticket(5), ticket(4)], { total: 6, nextCursor: 'cursor-2' })]]),
      () => ({ tickets: [], truncated: false, hierarchy: 'native' }),
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
      hierarchy: 'native',
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

/** 主 worktree 与它的附属 worktree；两者属于同一个仓库。 */
const MAIN_ROOT = '/repo'
const ATTACHED_ROOT = '/repo-feature'

/** 作用域按仓库解析：同一仓库的多个 worktree 归到主 worktree 根目录。 */
function scopedService(
  scopes: Readonly<Record<string, string>>,
  tracker: Tracker,
  store: SnapshotStore = memoryStore(),
) {
  const resolved: ResolvedBackend = {
    kind: 'github',
    tracker,
    choice: CHOICE,
    address: { host: 'github.com', path: 'cnzgray/repo' },
  }
  return createSnapshotService({
    resolve: () => Promise.resolve(resolved),
    scope: (workspaceRoot) => Promise.resolve(scopes[workspaceRoot] ?? workspaceRoot),
    now: () => NOW,
    labels: TRACKER_LABELS,
    log: () => {},
    store,
  })
}

/** 本地 Markdown 后端：作用域仍是仓库，但缓存键退回工作区。 */
function markdownService(
  scopes: Readonly<Record<string, string>>,
  tracker: Tracker,
  store: SnapshotStore = memoryStore(),
) {
  const resolved: ResolvedBackend = {
    kind: 'markdown',
    tracker,
    choice: { kind: 'markdown', source: 'no-remote' },
    address: undefined,
  }
  return createSnapshotService({
    resolve: () => Promise.resolve(resolved),
    scope: (workspaceRoot) => Promise.resolve(scopes[workspaceRoot] ?? workspaceRoot),
    now: () => NOW,
    labels: TRACKER_LABELS,
    log: () => {},
    store,
  })
}

describe('仓库作用域', () => {
  it('同一仓库的两个 worktree 共用一份缓存：第二个不再拉取工单列表', async () => {
    const { tracker, calls } = pagedTracker(new Map([['', page([ticket(1)])]]))
    const snapshots = scopedService({ [MAIN_ROOT]: MAIN_ROOT, [ATTACHED_ROOT]: MAIN_ROOT }, tracker)

    await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: MAIN_ROOT })
    const second = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ATTACHED_ROOT }),
    )

    expect(calls).toEqual([undefined])
    expect(refs(second)).toEqual(['#1'])
  })

  it('同一仓库的两个 worktree 同时首屏只拉一次', async () => {
    const { tracker, calls } = pagedTracker(new Map([['', page([ticket(1)])]]))
    const snapshots = scopedService({ [MAIN_ROOT]: MAIN_ROOT, [ATTACHED_ROOT]: MAIN_ROOT }, tracker)

    const [first, second] = await Promise.all([
      snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: MAIN_ROOT }),
      snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ATTACHED_ROOT }),
    ])

    expect(calls).toEqual([undefined])
    expect(refs(resultOf(first))).toEqual(['#1'])
    expect(refs(resultOf(second))).toEqual(['#1'])
  })

  it('并发首屏共享作用域时，本地 Markdown 仍各读各的', async () => {
    const store = memoryStore()
    const { tracker, calls } = pagedTracker(new Map([['', page([ticket(1)])]]))
    const snapshots = markdownService(
      { [MAIN_ROOT]: MAIN_ROOT, [ATTACHED_ROOT]: MAIN_ROOT },
      tracker,
      store,
    )

    const [first, second] = await Promise.all([
      snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: MAIN_ROOT }),
      snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ATTACHED_ROOT }),
    ])

    // 两次拉取：共享到的那份属于主 worktree，附属 worktree 自己再读一次。
    expect(calls).toEqual([undefined, undefined])
    expect(refs(resultOf(first))).toEqual(['#1'])
    expect(refs(resultOf(second))).toEqual(['#1'])
    expect(store.entries.has(MAIN_ROOT)).toBe(true)
    expect(store.entries.has(ATTACHED_ROOT)).toBe(true)
  })

  it('两个 worktree 共用一条增量链，刷新写回共享条目', async () => {
    const store = memoryStore()
    store.entries.set(
      MAIN_ROOT,
      storeEntry({
        scopeRoot: MAIN_ROOT,
        workspaceRoot: MAIN_ROOT,
        fetchedAt: NOW - 60_000,
        loaded: 2,
        total: 2,
      }),
    )
    const { tracker, calls, changeCalls } = pagedTracker(new Map(), () => ({
      tickets: [],
      truncated: false,
      hierarchy: 'native',
    }))
    const snapshots = scopedService({ [MAIN_ROOT]: MAIN_ROOT, [ATTACHED_ROOT]: MAIN_ROOT }, tracker, store)

    await snapshots.handle(RPC_METHODS.snapshotRefresh, { workspaceRoot: ATTACHED_ROOT })

    // 窗口起点取共享条目的 fetchedAt，再向前重叠一分钟。
    expect(changeCalls).toEqual([NOW - 120_000])
    expect(calls).toEqual([])
    expect(store.entries.get(MAIN_ROOT)?.workspaceRoot).toBe(ATTACHED_ROOT)
  })

  it('两个仓库各存各的，互不命中', async () => {
    const store = memoryStore()
    const first = pagedTracker(new Map([['', page([ticket(1)])]]))
    const second = pagedTracker(new Map([['', page([ticket(2)])]]))
    const snapshots = createSnapshotService({
      resolve: (root) =>
        Promise.resolve({
          kind: 'github',
          tracker: root === '/repo-a' ? first.tracker : second.tracker,
          choice: CHOICE,
          address: { host: 'github.com', path: root === '/repo-a' ? 'owner/a' : 'owner/b' },
        }),
      scope: (root) => Promise.resolve(root),
      now: () => NOW,
      labels: TRACKER_LABELS,
      log: () => {},
      store,
    })

    await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: '/repo-a' })
    await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: '/repo-b' })

    expect(first.calls).toEqual([undefined])
    expect(second.calls).toEqual([undefined])
    expect(store.entries.size).toBe(2)
  })

  it('本地 Markdown 按工作区隔离：另一个 worktree 不命中共享作用域', async () => {
    const store = memoryStore()
    const { tracker, calls } = pagedTracker(new Map([['', page([ticket(1)])]]))
    const snapshots = markdownService(
      { [MAIN_ROOT]: MAIN_ROOT, [ATTACHED_ROOT]: MAIN_ROOT },
      tracker,
      store,
    )

    await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: MAIN_ROOT })
    const second = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ATTACHED_ROOT }),
    )

    expect(calls).toEqual([undefined, undefined])
    expect(refs(second)).toEqual(['#1'])
    // 两份缓存各存各的：键是工作区，不是共享作用域。
    expect(store.entries.has(MAIN_ROOT)).toBe(true)
    expect(store.entries.has(ATTACHED_ROOT)).toBe(true)
  })

  it('远端失败时另一个 worktree 仍显示共享缓存并带上原因', async () => {
    const store = memoryStore()
    store.entries.set(
      MAIN_ROOT,
      storeEntry({ scopeRoot: MAIN_ROOT, workspaceRoot: MAIN_ROOT }),
    )
    const tracker: Tracker = {
      fetchSnapshot: () => Promise.reject(new TrackerError('fetch-failed', '远端挂了')),
    }
    const snapshots = scopedService({ [MAIN_ROOT]: MAIN_ROOT, [ATTACHED_ROOT]: MAIN_ROOT }, tracker, store)

    const snapshot = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotRefresh, { workspaceRoot: ATTACHED_ROOT }),
    )

    expect(snapshot.stale).toBe(true)
    expect(snapshot.refreshError).toMatchObject({ code: 'fetch-failed' })
    expect(refs(snapshot)).toEqual(['#5', '#4'])
  })
})

describe('写操作跨 worktree 可见（端到端）', () => {
  let cacheRoot = ''

  beforeEach(async () => {
    cacheRoot = await mkdtemp(join(tmpdir(), 'mattwf-e2e-'))
  })

  afterEach(async () => {
    await rm(cacheRoot, { recursive: true, force: true })
  })

  /** 真实的文件快照库：两个服务（以及「重启后」的新服务）共用同一个目录。 */
  function fileStore(): SnapshotStore {
    return createNodeSnapshotStore({ root: join(cacheRoot, 'cache'), home: cacheRoot, tmp: cacheRoot })
  }

  /**
   * 远端固定返回 #1、#2，增量永远报「没有变化」：
   * 读到的改动只可能来自共享缓存，不可能来自远端。
   */
  function remote() {
    const lists: string[] = []
    const writes: string[] = []
    const tracker: Tracker = {
      fetchSnapshot: () => {
        lists.push('list')
        return Promise.resolve(page([ticket(1), ticket(2)]))
      },
      fetchChanges: () => Promise.resolve({ tickets: [], truncated: false, hierarchy: 'native' }),
      updateTicket: (_root: string, reference: TicketReference, patch: TicketPatch) => {
        writes.push(`update ${reference.ref} ${JSON.stringify(patch)}`)
        return Promise.resolve()
      },
      canDeleteTickets: () => Promise.resolve(true),
      deleteTicket: (_root: string, reference: TicketReference) => {
        writes.push(`delete ${reference.ref}`)
        return Promise.resolve()
      },
    }
    return { tracker, lists, writes }
  }

  /** 与 main.ts 相同的装配：快照服务与工单服务共用解析器、作用域与快照库。 */
  function host(tracker: Tracker, store: SnapshotStore) {
    const resolved: ResolvedBackend = {
      kind: 'github',
      tracker,
      choice: CHOICE,
      address: { host: 'github.com', path: 'cnzgray/repo' },
    }
    const scopes: Readonly<Record<string, string>> = {
      [MAIN_ROOT]: MAIN_ROOT,
      [ATTACHED_ROOT]: MAIN_ROOT,
    }
    const deps = {
      resolve: () => Promise.resolve(resolved),
      scope: (workspaceRoot: string) => Promise.resolve(scopes[workspaceRoot] ?? workspaceRoot),
      now: () => NOW,
      log: () => {},
      store,
    }
    return {
      snapshots: createSnapshotService({ ...deps, labels: TRACKER_LABELS }),
      tickets: createTicketService(deps),
    }
  }

  function ticketOf(snapshot: WorkspaceSnapshot, ref: string) {
    return snapshot.tickets.find((item) => item.ref === ref)
  }

  it('附属 worktree 打的标签，主 worktree 刷新后读到更新后的票', async () => {
    const { tracker, lists, writes } = remote()
    const { snapshots, tickets } = host(tracker, fileStore())

    await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: MAIN_ROOT })
    const updated = await tickets.handle(RPC_METHODS.ticketUpdate, {
      workspaceRoot: ATTACHED_ROOT,
      ref: '#1',
      number: 1,
      patch: { labels: ['bug'] },
    })
    expect(updated.ok).toBe(true)
    // 面板写入成功后会刷新一次；随后切回主 worktree 读取。
    await snapshots.handle(RPC_METHODS.snapshotRefresh, { workspaceRoot: ATTACHED_ROOT })
    const seen = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: MAIN_ROOT }),
    )

    expect(writes).toEqual(['update #1 {"labels":["bug"]}'])
    expect(ticketOf(seen, '#1')?.labels).toEqual(['bug'])
    // 全程只发过一次列表查询：刷新走的是共享增量链。
    expect(lists).toEqual(['list'])
  })

  it('附属 worktree 打的标签，宿主重启后主 worktree 直接从共享缓存读到', async () => {
    const { tracker, lists } = remote()
    const before = host(tracker, fileStore())
    await before.snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: MAIN_ROOT })
    await before.tickets.handle(RPC_METHODS.ticketUpdate, {
      workspaceRoot: ATTACHED_ROOT,
      ref: '#1',
      number: 1,
      patch: { labels: ['bug'] },
    })

    // 新的宿主进程：内存是空的，只有磁盘上的快照库。
    const after = host(tracker, fileStore())
    const seen = resultOf(
      await after.snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: MAIN_ROOT }),
    )

    expect(ticketOf(seen, '#1')?.labels).toEqual(['bug'])
    expect(lists).toEqual(['list'])
  })

  it('附属 worktree 删掉的票，主 worktree 的缓存里也不再留着它', async () => {
    const { tracker, lists, writes } = remote()
    const before = host(tracker, fileStore())
    await before.snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: MAIN_ROOT })
    const deleted = await before.tickets.handle(RPC_METHODS.ticketDelete, {
      workspaceRoot: ATTACHED_ROOT,
      ref: '#1',
      number: 1,
      confirm: TICKET_DELETE_CONFIRMATION,
    })
    expect(deleted.ok).toBe(true)

    const after = host(tracker, fileStore())
    const seen = resultOf(
      await after.snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: MAIN_ROOT }),
    )

    expect(writes).toEqual(['delete #1'])
    expect(refs(seen)).toEqual(['#2'])
    expect(lists).toEqual(['list'])
  })
})

describe('当前用户与分配人的快照传播', () => {
  it('缓存优先快照带当前用户与分配人', async () => {
    const store = memoryStore()
    store.entries.set(
      ROOT,
      storeEntry({ tickets: [ticket(5, { assignees: ['alice'] }), ticket(4)] }),
    )
    const { tracker } = pagedTracker(new Map())

    const snapshot = resultOf(
      await service(tracker, store).handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT }),
    )

    expect(snapshot.source).toBe('cache')
    expect(snapshot.viewer).toBe('cnzgray')
    expect(snapshot.tickets.find((item) => item.ref === '#5')?.assignees).toEqual(['alice'])
  })

  it('全量刷新更新当前用户，并写回缓存', async () => {
    const store = memoryStore()
    const { tracker } = pagedTracker(
      new Map([['', page([ticket(1)], { viewer: 'newbie' })]]),
    )

    const snapshot = resultOf(
      await service(tracker, store).handle(RPC_METHODS.snapshotRefresh, {
        workspaceRoot: ROOT,
      }),
    )

    expect(snapshot.viewer).toBe('newbie')
    expect(store.entries.get(ROOT)?.viewer).toBe('newbie')
  })

  it('全量返回 null 时沿用上一次已知身份', async () => {
    const store = memoryStore()
    store.entries.set(ROOT, storeEntry({ viewer: 'cnzgray' }))
    const { tracker } = pagedTracker(new Map([['', page([ticket(5)], { viewer: null })]]))
    const snapshots = service(tracker, store)
    await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT })

    const snapshot = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotRefresh, { workspaceRoot: ROOT }),
    )

    expect(snapshot.viewer).toBe('cnzgray')
  })

  it('增量有身份时覆盖基准，没有时沿用基准', async () => {
    const withViewer = memoryStore()
    withViewer.entries.set(ROOT, storeEntry({ nextCursor: 'cursor-2', viewer: 'old' }))
    const updated = pagedTracker(new Map(), () => ({
      tickets: [ticket(6, { updatedAt: '2026-11-21T00:00:00Z' })],
      truncated: false,
      viewer: 'new',
      hierarchy: 'native',
    }))
    const first = resultOf(
      await service(updated.tracker, withViewer).handle(RPC_METHODS.snapshotRefresh, {
        workspaceRoot: ROOT,
      }),
    )

    const kept = memoryStore()
    kept.entries.set(ROOT, storeEntry({ nextCursor: 'cursor-2', viewer: 'old' }))
    const silent = pagedTracker(new Map(), () => ({
      tickets: [ticket(6, { updatedAt: '2026-11-21T00:00:00Z' })],
      truncated: false,
      hierarchy: 'native',
    }))
    const second = resultOf(
      await service(silent.tracker, kept).handle(RPC_METHODS.snapshotRefresh, {
        workspaceRoot: ROOT,
      }),
    )

    expect(first.viewer).toBe('new')
    expect(withViewer.entries.get(ROOT)?.viewer).toBe('new')
    expect(second.viewer).toBe('old')
  })

  it('加载更多时扩窗响应没带身份就沿用当前身份', async () => {
    const store = memoryStore()
    store.entries.set(
      ROOT,
      storeEntry({ nextCursor: 'cursor-2', total: 3, tickets: [ticket(5)] }),
    )
    const { tracker } = pagedTracker(
      new Map([['cursor-2', page([ticket(4)], { total: 3, viewer: null })]]),
    )
    const snapshots = service(tracker, store)
    await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT })

    const snapshot = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotLoadMore, { workspaceRoot: ROOT }),
    )

    expect(snapshot.viewer).toBe('cnzgray')
    expect(snapshot.tickets.find((item) => item.ref === '#4')?.assignees).toEqual([])
  })

  it('加载更多时扩窗响应带了新身份就更新', async () => {
    const store = memoryStore()
    store.entries.set(
      ROOT,
      storeEntry({ nextCursor: 'cursor-2', total: 3, tickets: [ticket(5)] }),
    )
    const { tracker } = pagedTracker(
      new Map([['cursor-2', page([ticket(4)], { total: 3, viewer: 'other' })]]),
    )
    const snapshots = service(tracker, store)
    await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT })

    const snapshot = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotLoadMore, { workspaceRoot: ROOT }),
    )

    expect(snapshot.viewer).toBe('other')
  })
})
