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
import { createSnapshotService, type SnapshotServiceResult } from './snapshot-service.ts'
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
    // 当前远端后端的列表响应都带页面地址；旧缓存另用 unlinkedTicket 造。
    url: `https://github.com/cnzgray/repo/issues/${String(number)}`,
    ...overrides,
  }
}

/** 升级前缓存里的票：没有 url 字段。 */
function unlinkedTicket(number: number): Ticket {
  const copy = { ...ticket(number) }
  delete copy.url
  return copy
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
  const total = options.total ?? tickets.length
  return {
    repository: 'cnzgray/repo',
    fetchedAt: NOW,
    loaded: tickets.length,
    total,
    tickets,
    viewer: options.viewer ?? null,
    hierarchy: 'native',
    revision: { id: `page:${String(total)}`, total },
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

/** 内存快照库：提交、版本与变化集都按目录实现的语义走。 */
function memoryStore(): SnapshotStore & { readonly entries: Map<string, SnapshotStoreEntry> } {
  const entries = new Map<string, SnapshotStoreEntry>()
  const log = new Map<
    string,
    { readonly revision: number; readonly upserts: readonly string[]; readonly removed: readonly string[] }[]
  >()

  return {
    entries,
    read: (key) => Promise.resolve(entries.get(key)),
    write: (entry) => {
      const key = storeKeyOf(entry.backend, entry.scopeRoot, entry.workspaceRoot)
      const previous = entries.get(key)
      const previousByRef = new Map(previous?.tickets.map((item) => [item.ref, item] as const))
      const nextRefs = new Set(entry.tickets.map((item) => item.ref))
      const changed = entry.tickets.filter((item) => {
        const old = previousByRef.get(item.ref)
        return old === undefined || JSON.stringify(old) !== JSON.stringify(item)
      })
      const removed = (previous?.tickets ?? []).flatMap((item) =>
        nextRefs.has(item.ref) ? [] : [item.ref],
      )
      const revision = (previous?.storeRevision ?? 0) + 1
      entries.set(key, { ...entry, loaded: entry.tickets.length, storeRevision: revision })
      log.set(key, [
        ...(log.get(key) ?? []),
        { revision, upserts: changed.map((item) => item.ref), removed },
      ])
      return Promise.resolve(revision)
    },
    remove: (key) => {
      entries.delete(key)
      log.delete(key)
      return Promise.resolve()
    },
    list: () => Promise.resolve([...entries.values()]),
    clear: () => {
      const count = entries.size
      entries.clear()
      log.clear()
      return Promise.resolve(count)
    },
    prune: () => Promise.resolve(0),
    patchTicket: (key, ref, patch) => {
      const entry = entries.get(key)
      const index = entry?.tickets.findIndex((item) => item.ref === ref) ?? -1
      if (entry === undefined || index < 0) return Promise.resolve(false)
      const tickets = [...entry.tickets]
      const current = tickets[index]
      if (current === undefined) return Promise.resolve(false)
      tickets[index] = {
        ...current,
        ...(patch.labels === undefined ? {} : { labels: patch.labels }),
        ...(patch.state === undefined ? {} : { state: patch.state }),
      }
      return memoryStoreWrite(entry, { ...entry, tickets }).then(() => true)
    },
    removeTicket: (key, ref) => {
      const entry = entries.get(key)
      if (entry === undefined) return Promise.resolve(false)
      const tickets = entry.tickets.filter((item) => item.ref !== ref)
      if (tickets.length === entry.tickets.length) return Promise.resolve(false)
      return memoryStoreWrite(entry, { ...entry, tickets }).then(() => true)
    },
    revision: (key) => Promise.resolve(entries.get(key)?.storeRevision),
    changesSince: (key, fromRevision) => {
      const entry = entries.get(key)
      if (entry === undefined || fromRevision > entry.storeRevision) return Promise.resolve(undefined)
      const final = new Map<string, 'upsert' | 'removed'>()
      for (const record of log.get(key) ?? []) {
        if (record.revision <= fromRevision) continue
        for (const ref of record.upserts) final.set(ref, 'upsert')
        for (const ref of record.removed) final.set(ref, 'removed')
      }
      const changedRefs = new Set(
        [...final].flatMap(([ref, state]) => (state === 'upsert' ? [ref] : [])),
      )
      return Promise.resolve({
        fromRevision,
        revision: entry.storeRevision,
        tickets: entry.tickets.filter((item) => changedRefs.has(item.ref)),
        removed: [...final].flatMap(([ref, state]) => (state === 'removed' ? [ref] : [])),
      })
    },
    location: () => '~/.orca-mattpocock-workflow/cache',
  }

  /** patch / remove 复用同一套提交口径：版本 +1，变化行写进日志。 */
  function memoryStoreWrite(
    entry: SnapshotStoreEntry,
    next: SnapshotStoreEntry,
  ): Promise<void> {
    const key = storeKeyOf(next.backend, next.scopeRoot, next.workspaceRoot)
    const changed = next.tickets.filter((item) => {
      const old = entry.tickets.find((candidate) => candidate.ref === item.ref)
      return old === undefined || old !== item
    })
    const nextRefs = new Set(next.tickets.map((item) => item.ref))
    const removed = entry.tickets.flatMap((item) => (nextRefs.has(item.ref) ? [] : [item.ref]))
    const revision = entry.storeRevision + 1
    entries.set(key, { ...next, storeRevision: revision })
    log.set(key, [
      ...(log.get(key) ?? []),
      { revision, upserts: changed.map((item) => item.ref), removed },
    ])
    return Promise.resolve()
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
    revision: { id: 'stored', total: 6 },
    storeRevision: 1,
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

function resultOf(result: RpcResult<SnapshotServiceResult>): WorkspaceSnapshot {
  if (!result.ok) throw new Error(`预期成功，实际失败：${result.error.message}`)
  if ('kind' in result.result) {
    if (result.result.kind === 'snapshot') return result.result.snapshot
    throw new Error(`预期整份快照，实际是 ${result.result.kind}`)
  }
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

  it('工单链接透传到快照，并随缓存进出', async () => {
    const store = memoryStore()
    const url = 'https://github.com/cnzgray/repo/issues/5'
    const online = service(
      pagedTracker(new Map([['', page([ticket(5, { url })])]])).tracker,
      store,
    )

    const live = resultOf(
      await online.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT }),
    )

    expect(live.tickets.find((item) => item.ref === '#5')?.url).toBe(url)
    expect(store.entries.get(ROOT)?.tickets.find((item) => item.ref === '#5')?.url).toBe(url)

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
    expect(cached.tickets.find((item) => item.ref === '#5')?.url).toBe(url)
  })

  it('旧缓存缺工单链接时退回全量重拉，未变更的票也补齐', async () => {
    const store = memoryStore()
    store.entries.set(ROOT, storeEntry({ loaded: 1, total: 1, tickets: [unlinkedTicket(5)] }))
    const url = 'https://github.com/cnzgray/repo/issues/5'
    const { tracker, calls, changeCalls } = pagedTracker(
      new Map([['', page([ticket(5, { url })], { total: 1 })]]),
      () => ({ tickets: [], truncated: false, hierarchy: 'native', revision: { id: 'same', total: 1 } }),
    )

    const snapshot = resultOf(
      await service(tracker, store).handle(RPC_METHODS.snapshotRefresh, { workspaceRoot: ROOT }),
    )

    expect(changeCalls).toEqual([])
    expect(calls).toEqual([undefined])
    expect(snapshot.tickets.find((item) => item.ref === '#5')?.url).toBe(url)
    expect(store.entries.get(ROOT)?.tickets.find((item) => item.ref === '#5')?.url).toBe(url)
  })

  it('增量父子能力与库里不一致时退回全量重拉', async () => {
    const store = memoryStore()
    store.entries.set(
      ROOT,
      storeEntry({ loaded: 1, total: 1, tickets: [ticket(5)] }),
    )
    const { tracker, calls, changeCalls } = pagedTracker(
      new Map([['', page([ticket(5, { parent: '#4' }), ticket(4)], { total: 2 })]]),
      () => ({ tickets: [ticket(5, { title: '只取到半棵树' })], truncated: false, hierarchy: 'none', revision: { id: 'half', total: 1 } }),
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
        total: 2,
        nextCursor: 'cursor-2',
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
        revision: { id: 'two', total: 2 },
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
      () => ({ tickets: [], truncated: false, hierarchy: 'native', revision: { id: 'same', total: 1 } }),
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
      revision: { id: 'six', total: 6 },
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

describe('刷新版本协议', () => {
  /** 远端不变、增量窗口也只回正文回退的假后端。 */
  function stableTracker(
    changes: () => TrackerChanges = () => ({
      tickets: [],
      truncated: false,
      revision: { id: 'page:2', total: 2 },
      hierarchy: 'native',
    }),
    full: () => TrackerSnapshot = () => page([ticket(5), ticket(4)], { total: 2 }),
  ): { readonly tracker: Tracker; readonly calls: (string | undefined)[] } {
    const calls: (string | undefined)[] = []
    return {
      calls,
      tracker: {
        fetchSnapshot: (_root, request) => {
          calls.push(request?.cursor)
          return Promise.resolve(full())
        },
        fetchChanges: (_root, _since) => Promise.resolve(changes()),
      },
    }
  }

  it('数据没变且客户端库版本一致时回 not-modified，不写库', async () => {
    const store = memoryStore()
    const { tracker } = stableTracker()
    const snapshots = service(tracker, store)
    const first = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT }),
    )

    const result = await snapshots.handle(RPC_METHODS.snapshotRefresh, {
      workspaceRoot: ROOT,
      storeRevision: first.storeRevision,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result).toMatchObject({
      kind: 'not-modified',
      revision: 'page:2',
      storeRevision: first.storeRevision,
      fetchedAt: first.fetchedAt,
    })
    await expect(store.revision(ROOT)).resolves.toBe(first.storeRevision)
  })

  it('数据没变但客户端没带库版本：回整份且不写库', async () => {
    const store = memoryStore()
    const { tracker } = stableTracker()
    const snapshots = service(tracker, store)
    const first = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT }),
    )

    const result = await snapshots.handle(RPC_METHODS.snapshotRefresh, {
      workspaceRoot: ROOT,
    })

    expect(result.ok).toBe(true)
    if (!result.ok || !('kind' in result.result)) return
    expect(result.result.kind).toBe('snapshot')
    if (result.result.kind !== 'snapshot') return
    expect(result.result.snapshot.storeRevision).toBe(first.storeRevision)
    await expect(store.revision(ROOT)).resolves.toBe(first.storeRevision)
  })

  it('库里有客户端没见过的写入时，即使远端没变也只回变化行', async () => {
    const store = memoryStore()
    const { tracker, calls } = stableTracker()
    const snapshots = service(tracker, store)
    const first = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT }),
    )
    // 详情页写操作同步了缓存：远端版本不变，但本地库前进了一版。
    await store.patchTicket(ROOT, '#5', { labels: ['bug'] })

    const result = await snapshots.handle(RPC_METHODS.snapshotRefresh, {
      workspaceRoot: ROOT,
      storeRevision: first.storeRevision,
    })

    expect(result.ok).toBe(true)
    if (!result.ok || !('kind' in result.result)) return
    expect(result.result.kind).toBe('delta')
    if (result.result.kind !== 'delta') return
    expect(result.result.changed.map((item) => [item.ref, item.labels])).toEqual([
      ['#5', ['bug']],
    ])
    expect(result.result.removed).toEqual([])
    expect(result.result.storeRevision).toBeGreaterThan(first.storeRevision)
    // 本地写入只推进了一版；刷新数据没变，不再写库。
    await expect(store.revision(ROOT)).resolves.toBe(result.result.storeRevision)
    // 远端没变：没有重新拉列表。
    expect(calls).toEqual([undefined])
  })

  it('权威总数漂移时退回全量重拉', async () => {
    const store = memoryStore()
    const { tracker, calls } = stableTracker(() => ({
      tickets: [ticket(5)],
      truncated: false,
      total: 3,
      revision: { id: 'page:3', total: 3 },
      hierarchy: 'native',
    }))
    let lists = 0
    const snapshots = service(
      {
        ...tracker,
        fetchSnapshot: (_root, request) => {
          calls.push(request?.cursor)
          lists += 1
          return Promise.resolve(
            lists === 1
              ? page([ticket(5), ticket(4)], { total: 2 })
              : page([ticket(5), ticket(4), ticket(3)], { total: 3 }),
          )
        },
      },
      store,
    )
    const first = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT }),
    )
    expect(first.total).toBe(2)
    expect(store.entries.get(ROOT)?.total).toBe(2)

    const result = await snapshots.handle(RPC_METHODS.snapshotRefresh, {
      workspaceRoot: ROOT,
      storeRevision: first.storeRevision,
    })

    expect(result.ok).toBe(true)
    if (!result.ok || !('kind' in result.result)) return
    // 全量重拉后仍按客户端基线收成变化行：只回新增的 #3，不带整棵树。
    expect(result.result.kind).toBe('delta')
    if (result.result.kind !== 'delta') return
    expect(result.result.changed.map((item) => item.ref)).toEqual(['#3'])
    expect(result.result.loaded).toBe(3)
    expect(result.result.total).toBe(3)
    // 第一次是首屏，第二次是为总数漂移重拉的一页。
    expect(calls).toEqual([undefined, undefined])
  })

  it('增量被截断时退回全量重拉，全量一致则回 not-modified', async () => {
    const store = memoryStore()
    const { tracker, calls } = stableTracker(() => ({
      tickets: [ticket(5)],
      truncated: true,
      revision: { id: 'page:2', total: 2 },
      hierarchy: 'native',
    }))
    const snapshots = service(tracker, store)
    const first = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT }),
    )

    const result = await snapshots.handle(RPC_METHODS.snapshotRefresh, {
      workspaceRoot: ROOT,
      storeRevision: first.storeRevision,
    })

    expect(result.ok).toBe(true)
    if (!result.ok || !('kind' in result.result)) return
    // 截断的增量不可信，但全量重拉确认数据没变：不写库、不升版本。
    expect(result.result.kind).toBe('not-modified')
    expect(calls).toEqual([undefined, undefined])
    await expect(store.revision(ROOT)).resolves.toBe(first.storeRevision)
  })

  it('远端删掉的票在全量重拉后从列表消失，并写进墓碑', async () => {
    const store = memoryStore()
    const { tracker, calls } = stableTracker(() => ({
      tickets: [],
      truncated: false,
      total: 1,
      revision: { id: 'page:1', total: 1 },
      hierarchy: 'native',
    }))
    let lists = 0
    const snapshots = service(
      {
        ...tracker,
        fetchSnapshot: (_root, request) => {
          calls.push(request?.cursor)
          lists += 1
          return Promise.resolve(
            lists === 1
              ? page([ticket(5), ticket(4)], { total: 2 })
              : page([ticket(5)], { total: 1 }),
          )
        },
      },
      store,
    )
    const first = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT }),
    )

    const result = await snapshots.handle(RPC_METHODS.snapshotRefresh, {
      workspaceRoot: ROOT,
      storeRevision: first.storeRevision,
    })

    expect(result.ok).toBe(true)
    if (!result.ok || !('kind' in result.result)) return
    // 全量重拉把删除写进墓碑；返回给客户端的增量只带墓碑。
    expect(result.result.kind).toBe('delta')
    if (result.result.kind !== 'delta') return
    expect(result.result.changed).toEqual([])
    expect(result.result.removed).toEqual(['#4'])
    expect(store.entries.get(ROOT)?.tickets.map((item) => item.ref)).toEqual(['#5'])
    const changes = await store.changesSince(ROOT, first.storeRevision)
    expect(changes?.removed).toEqual(['#4'])
  })

  it('后端给不出版本号时退回全量，全量一致则回 not-modified', async () => {
    const store = memoryStore()
    const { tracker, calls } = stableTracker(() => ({
      tickets: [ticket(5)],
      truncated: false,
      revision: null,
      hierarchy: 'native',
    }))
    const snapshots = service(tracker, store)
    const first = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT }),
    )

    const result = await snapshots.handle(RPC_METHODS.snapshotRefresh, {
      workspaceRoot: ROOT,
      storeRevision: first.storeRevision,
    })

    expect(result.ok).toBe(true)
    if (!result.ok || !('kind' in result.result)) return
    expect(result.result.kind).toBe('not-modified')
    expect(calls).toEqual([undefined, undefined])
    await expect(store.revision(ROOT)).resolves.toBe(first.storeRevision)
  })
})

describe('刷新退避与缓存自洽', () => {
  it('连续失败后进入冷却：冷却期内不打后端，回包说明在退避', async () => {
    let clock = NOW
    const store = memoryStore()
    store.entries.set(ROOT, storeEntry({ total: 2, tickets: [ticket(5), ticket(4)] }))
    let calls = 0
    const tracker: Tracker = {
      fetchSnapshot: () => {
        calls += 1
        return Promise.reject(new TrackerError('fetch-failed', '远端挂了'))
      },
    }
    const snapshots = service(tracker, store, () => clock)

    const first = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotRefresh, { workspaceRoot: ROOT }),
    )
    expect(first.stale).toBe(true)
    expect(calls).toBe(1)

    clock = NOW + 1_000
    const cooling = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotRefresh, { workspaceRoot: ROOT }),
    )
    expect(calls).toBe(1)
    expect(cooling.refreshError?.message).toContain('退避')

    // 手动全量刷新是人的动作：冷却中也直接打后端。
    clock = NOW + 2_000
    await snapshots.handle(RPC_METHODS.snapshotRefresh, { workspaceRoot: ROOT, full: true })
    expect(calls).toBe(2)
  })

  it('增量合并出的票数超过权威总数时退回全量，清掉幽灵票', async () => {
    const store = memoryStore()
    store.entries.set(
      ROOT,
      storeEntry({
        total: 2,
        tickets: [ticket(5), ticket(4)],
        revision: { id: 'two', total: 2 },
      }),
    )
    // 远端删掉 #4、新增 #6：总数不变，增量只看得见 #6。
    const { tracker } = pagedTracker(
      new Map([['', page([ticket(5), ticket(6)], { total: 2 })]]),
      () => ({
        tickets: [ticket(6)],
        truncated: false,
        total: 2,
        hierarchy: 'native',
        revision: { id: 'two', total: 2 },
      }),
    )
    const snapshots = service(tracker, store)

    const result = await snapshots.handle(RPC_METHODS.snapshotRefresh, {
      workspaceRoot: ROOT,
      storeRevision: 1,
    })

    expect(result.ok).toBe(true)
    if (!result.ok || !('kind' in result.result)) return
    expect(result.result.kind).toBe('delta')
    if (result.result.kind !== 'delta') return
    expect(result.result.changed.map((item) => item.ref)).toEqual(['#6'])
    expect(result.result.removed).toEqual(['#4'])
    expect(store.entries.get(ROOT)?.tickets.map((item) => item.ref)).toEqual(['#5', '#6'])
  })

  it('库里的票数大于总数时作废并按全量重拉', async () => {
    const store = memoryStore()
    store.entries.set(
      ROOT,
      storeEntry({
        loaded: 3,
        total: 2,
        tickets: [ticket(5), ticket(4), ticket(3)],
      }),
    )
    const { tracker, calls } = pagedTracker(
      new Map([['', page([ticket(5), ticket(4)], { total: 2 })]]),
    )
    const snapshots = service(tracker, store)

    const snapshot = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT }),
    )

    expect(calls).toEqual([undefined])
    expect(snapshot.tickets.map((item) => item.ref)).toEqual(['#5', '#4'])
    expect(store.entries.get(ROOT)?.tickets).toHaveLength(2)
  })

  it('同一基线的并发刷新只打一次后端', async () => {
    const store = memoryStore()
    store.entries.set(
      ROOT,
      storeEntry({
        total: 2,
        tickets: [ticket(5), ticket(4)],
        revision: { id: 'two', total: 2 },
      }),
    )
    let resolveGate: (changes: TrackerChanges) => void = () => {}
    const gate = new Promise<TrackerChanges>((resolve) => {
      resolveGate = resolve
    })
    let calls = 0
    const tracker: Tracker = {
      fetchSnapshot: () => Promise.resolve(page([ticket(5), ticket(4)], { total: 2 })),
      fetchChanges: () => {
        calls += 1
        return gate
      },
    }
    const snapshots = service(tracker, store)

    const first = snapshots.handle(RPC_METHODS.snapshotRefresh, {
      workspaceRoot: ROOT,
      storeRevision: 1,
    })
    const second = snapshots.handle(RPC_METHODS.snapshotRefresh, {
      workspaceRoot: ROOT,
      storeRevision: 1,
    })
    resolveGate({
      tickets: [],
      truncated: false,
      revision: { id: 'two', total: 2 },
      hierarchy: 'native',
    })

    const [left, right] = await Promise.all([first, second])
    expect(left).toEqual(right)
    expect(calls).toBe(1)
  })
})

describe('增量阻塞补齐范围', () => {
  it('首屏补齐全部开放票，增量只补变更过的开放票', async () => {
    const store = memoryStore()
    const targetBatches: (readonly TicketReference[])[] = []
    const tracker: Tracker = {
      fetchSnapshot: () => Promise.resolve(page([ticket(5), ticket(4)], { total: 2 })),
      fetchChanges: () =>
        Promise.resolve({
          tickets: [ticket(5, { title: '改过标题' })],
          truncated: false,
          total: 2,
          revision: { id: 'page:2', total: 2 },
          hierarchy: 'native',
        }),
      resolveBlockers: (_root, targets) => {
        targetBatches.push(targets)
        return Promise.resolve({ open: new Map(), blockedBy: new Map() })
      },
    }
    const snapshots = service(tracker, store)
    const first = resultOf(
      await snapshots.handle(RPC_METHODS.snapshotGet, { workspaceRoot: ROOT }),
    )
    expect(first.blockersFinalized).toBe(false)

    await snapshots.handle(RPC_METHODS.snapshotResolveBlockers, { workspaceRoot: ROOT })
    expect(targetBatches[0]?.map((item) => item.ref)).toEqual(['#5', '#4'])

    const refreshed = await snapshots.handle(RPC_METHODS.snapshotRefresh, {
      workspaceRoot: ROOT,
      storeRevision: first.storeRevision,
    })
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) return
    expect('kind' in refreshed.result ? refreshed.result.kind : 'snapshot').toBe('delta')

    await snapshots.handle(RPC_METHODS.snapshotResolveBlockers, { workspaceRoot: ROOT })
    expect(targetBatches[1]?.map((item) => item.ref)).toEqual(['#5'])
  })

  it('内存缓存为空时首次增量刷新仍补齐全部开放票', async () => {
    const store = memoryStore()
    const targetBatches: (readonly TicketReference[])[] = []
    const tracker: Tracker = {
      fetchSnapshot: () => Promise.resolve(page([ticket(5), ticket(4)], { total: 2 })),
      fetchChanges: () =>
        Promise.resolve({
          tickets: [ticket(5, { title: '改过标题' })],
          truncated: false,
          total: 2,
          revision: { id: 'page:2', total: 2 },
          hierarchy: 'native',
        }),
      resolveBlockers: (_root, targets) => {
        targetBatches.push(targets)
        return Promise.resolve({ open: new Map(), blockedBy: new Map() })
      },
    }
    // 第一个进程只负责把快照写进库，不补齐阻塞。
    const first = resultOf(
      await service(tracker, store).handle(RPC_METHODS.snapshotGet, {
        workspaceRoot: ROOT,
      }),
    )

    // 新进程内存为空：首个请求就是增量刷新。
    const restarted = service(tracker, store)
    const refreshed = await restarted.handle(RPC_METHODS.snapshotRefresh, {
      workspaceRoot: ROOT,
      storeRevision: first.storeRevision,
    })
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) return
    expect('kind' in refreshed.result ? refreshed.result.kind : 'snapshot').toBe('delta')

    await restarted.handle(RPC_METHODS.snapshotResolveBlockers, { workspaceRoot: ROOT })
    expect(targetBatches[0]?.map((item) => item.ref)).toEqual(['#5', '#4'])
  })
})

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

  it('两个 worktree 共用一条增量链，数据没变时不重写共享条目', async () => {
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
      revision: { id: 'two', total: 2 },
    }))
    const snapshots = scopedService({ [MAIN_ROOT]: MAIN_ROOT, [ATTACHED_ROOT]: MAIN_ROOT }, tracker, store)

    await snapshots.handle(RPC_METHODS.snapshotRefresh, { workspaceRoot: ATTACHED_ROOT })

    // 窗口起点取共享条目的 fetchedAt，再向前重叠一分钟。
    expect(changeCalls).toEqual([NOW - 120_000])
    expect(calls).toEqual([])
    // 数据没变：条目保持原样，不因附属 worktree 刷新而升版本或改归属。
    expect(store.entries.get(MAIN_ROOT)?.workspaceRoot).toBe(MAIN_ROOT)
    expect(store.entries.get(MAIN_ROOT)?.storeRevision).toBe(1)
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
      fetchChanges: () =>
        Promise.resolve({
          tickets: [],
          truncated: false,
          hierarchy: 'native',
          revision: { id: 'two', total: 2 },
        }),
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
      revision: { id: 'six', total: 6 },
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
      revision: { id: 'six', total: 6 },
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
