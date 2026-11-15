import { describe, expect, it } from 'vitest'

import type { SnapshotStore } from '../adapters/fs/snapshot-store.ts'
import type { BackendChoice } from '../core/backend.ts'
import { storeKeyOf } from '../core/repository-scope.ts'
import { SNAPSHOT_STORE_VERSION, type SnapshotStoreEntry } from '../core/snapshot-store.ts'
import type { Ticket, TicketPatch, TicketReference, Tracker } from '../core/ticket.ts'
import { RPC_METHODS, TICKET_DELETE_CONFIRMATION, type RpcResult } from '../protocol/tracker.ts'
import type { ResolvedBackend } from './backend-resolver.ts'
import { createTicketService } from './ticket-service.ts'

const NOW = 1_700_000_000_000
const MAIN = '/repo'
const ATTACHED = '/repo-feature'
const CHOICE: BackendChoice = { kind: 'github', source: 'remote' }

function ticket(number: number): Ticket {
  return {
    ref: `#${String(number)}`,
    number,
    title: `票 ${String(number)}`,
    state: 'open',
    labels: [],
    author: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    openBlockers: 0,
  }
}

/** 本地快照库里的条目；键与生产实现同一套规则。 */
function storedEntry(overrides: Partial<SnapshotStoreEntry> = {}): SnapshotStoreEntry {
  return {
    version: SNAPSHOT_STORE_VERSION,
    scopeRoot: MAIN,
    workspaceRoot: ATTACHED,
    backend: 'github',
    repository: 'cnzgray/repo',
    repositoryKey: 'github@github.com/cnzgray/repo',
    repositoryHost: 'github.com',
    fetchedAt: NOW,
    loaded: 1,
    total: 1,
    tickets: [ticket(1)],
    ...overrides,
  }
}

/** 内存快照库：与文件实现一样按缓存键寻址。 */
function memoryStore(initial: readonly SnapshotStoreEntry[] = []): SnapshotStore & {
  readonly entries: Map<string, SnapshotStoreEntry>
} {
  const entries = new Map<string, SnapshotStoreEntry>()
  for (const entry of initial) {
    entries.set(storeKeyOf(entry.backend, entry.scopeRoot, entry.workspaceRoot), entry)
  }
  const read = (key: string): Promise<SnapshotStoreEntry | undefined> =>
    Promise.resolve(entries.get(key))
  const write = (entry: SnapshotStoreEntry): Promise<void> => {
    entries.set(storeKeyOf(entry.backend, entry.scopeRoot, entry.workspaceRoot), entry)
    return Promise.resolve()
  }
  return {
    entries,
    read,
    write,
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
    patchTicket: (key, ref, patch) => patchIn(entries, key, ref, patch),
    removeTicket: (key, ref) => removeFrom(entries, key, ref),
    location: () => '~/.orca-mattpocock-workflow/cache',
  }
}

function patchIn(
  entries: Map<string, SnapshotStoreEntry>,
  key: string,
  ref: string,
  patch: TicketPatch,
): Promise<boolean> {
  const entry = entries.get(key)
  if (entry === undefined) return Promise.resolve(false)
  const index = entry.tickets.findIndex((item) => item.ref === ref)
  if (index < 0) return Promise.resolve(false)
  const current = entry.tickets[index]
  if (current === undefined) return Promise.resolve(false)
  const tickets = [...entry.tickets]
  tickets[index] = {
    ...current,
    ...(patch.labels === undefined ? {} : { labels: patch.labels }),
    ...(patch.state === undefined ? {} : { state: patch.state }),
  }
  entries.set(key, { ...entry, tickets })
  return Promise.resolve(true)
}

function removeFrom(
  entries: Map<string, SnapshotStoreEntry>,
  key: string,
  ref: string,
): Promise<boolean> {
  const entry = entries.get(key)
  if (entry === undefined) return Promise.resolve(false)
  const tickets = entry.tickets.filter((item) => item.ref !== ref)
  if (tickets.length === entry.tickets.length) return Promise.resolve(false)
  entries.set(key, { ...entry, tickets })
  return Promise.resolve(true)
}

/** 只实现写操作会用到的方法；调用记录用来确认真的动了远端。 */
function tracker(calls: string[]): Tracker {
  return {
    fetchSnapshot: () => Promise.reject(new Error('写操作不该拉列表')),
    updateTicket: (_root: string, reference: TicketReference, patch: TicketPatch) => {
      calls.push(`update ${reference.ref} ${JSON.stringify(patch)}`)
      return Promise.resolve()
    },
    canDeleteTickets: () => Promise.resolve(true),
    deleteTicket: (_root: string, reference: TicketReference) => {
      calls.push(`delete ${reference.ref}`)
      return Promise.resolve()
    },
  }
}

function service(
  store: SnapshotStore,
  scope: (workspaceRoot: string) => string,
  calls: string[],
) {
  const resolved: ResolvedBackend = {
    kind: 'github',
    tracker: tracker(calls),
    choice: CHOICE,
    address: { host: 'github.com', path: 'cnzgray/repo' },
  }
  return createTicketService({
    resolve: () => Promise.resolve(resolved),
    scope: (workspaceRoot) => Promise.resolve(scope(workspaceRoot)),
    now: () => NOW,
    log: () => {},
    store,
  })
}

function resultOf<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(`预期成功，实际失败：${result.error.message}`)
  return result.result
}

describe('写操作落到共享缓存', () => {
  it('在附属 worktree 打的标签写进仓库作用域那一份', async () => {
    const store = memoryStore([storedEntry()])
    const calls: string[] = []
    const tickets = service(store, () => MAIN, calls)

    resultOf(
      await tickets.handle(RPC_METHODS.ticketUpdate, {
        workspaceRoot: ATTACHED,
        ref: '#1',
        number: 1,
        patch: { labels: ['bug'], state: 'closed' },
      }),
    )

    const stored = store.entries.get(MAIN)
    expect(stored?.tickets[0]?.labels).toEqual(['bug'])
    expect(stored?.tickets[0]?.state).toBe('closed')
    // 远端确实改了；缓存没有在附属工作区另起一份。
    expect(calls).toEqual(['update #1 {"labels":["bug"],"state":"closed"}'])
    expect(store.entries.has(ATTACHED)).toBe(false)
  })

  it('在附属 worktree 删掉的票从共享缓存里消失', async () => {
    const store = memoryStore([storedEntry()])
    const calls: string[] = []
    const tickets = service(store, () => MAIN, calls)

    resultOf(
      await tickets.handle(RPC_METHODS.ticketDelete, {
        workspaceRoot: ATTACHED,
        ref: '#1',
        number: 1,
        confirm: TICKET_DELETE_CONFIRMATION,
      }),
    )

    expect(store.entries.get(MAIN)?.tickets).toEqual([])
    expect(calls).toEqual(['delete #1'])
    expect(store.entries.has(ATTACHED)).toBe(false)
  })
})
