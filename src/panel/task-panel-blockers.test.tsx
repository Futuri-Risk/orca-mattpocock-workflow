// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RpcResult, WorkspaceSnapshot } from '../protocol/tracker.ts'
import {
  click,
  find,
  mustFind,
  render,
  settle,
  settleWith,
  setupDom,
  teardownDom,
} from './dom-test-support.ts'
import type { PromptCopy } from './injection.ts'
import { TaskPanel } from './task-panel.tsx'
import {
  deferred,
  makeDetail,
  makeSnapshot,
  makeTicket,
  ok,
} from './ticket-detail-test-support.ts'
import type { PanelClient } from './transport.ts'

const COPY: PromptCopy = {
  canCopy: true,
  copy: async () => ({ outcome: 'copied', reason: null }),
}

const BLOCKER = makeTicket({
  ref: '#1',
  number: 1,
  title: 'Bravo',
  state: 'open',
  status: 'open',
  skillAction: 'none',
  skillActionReason: 'untriaged',
})

const BLOCKED = makeTicket({
  ref: '#2',
  number: 2,
  title: '被阻塞票',
  status: 'blocked',
  skillAction: 'none',
  skillActionReason: 'blocked',
  openBlockers: 1,
  blockedBy: ['#1'],
})

const OTHER = makeTicket({ ref: '#3', number: 3, title: 'Charlie' })

const SNAPSHOT = makeSnapshot({ tickets: [BLOCKER, BLOCKED, OTHER] })

interface PanelClientOptions {
  readonly get?: PanelClient['get']
  readonly getDetail?: PanelClient['getDetail']
  readonly refresh?: PanelClient['refresh']
  readonly resolveBlockers?: PanelClient['resolveBlockers']
  readonly updateTicket?: PanelClient['updateTicket']
}

/** 只实现面板用例会走到的入口。 */
function clientWith(options: PanelClientOptions = {}): PanelClient {
  return {
    get: options.get ?? (async () => ok(SNAPSHOT)),
    getDetail:
      options.getDetail ??
      (async (_root: string, ref: string, number: number | null) =>
        ok(
          makeDetail({
            ref,
            number,
            title: `详情 ${ref}`,
            capabilities: {
              labels: false,
              assignees: false,
              state: true,
              link: false,
              delete: false,
            },
          }),
        )),
    refresh: options.refresh ?? (async () => ok(SNAPSHOT)),
    resolveBlockers: options.resolveBlockers ?? (async () => ok(SNAPSHOT)),
    updateTicket:
      options.updateTicket ?? (async () => ok({ applied: true as const })),
    getOptions: async () => ok({ labels: [], assignees: [] }),
    loadMore: async () => ok(SNAPSHOT),
    deleteTicket: async () => ok({ deleted: true as const }),
  } as unknown as PanelClient
}

function rowFor(ref: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('[data-testid="ticket-row"]')].find(
    (element) => element.getAttribute('data-ref') === ref,
  )
  if (row === undefined) throw new Error(`缺少 ${ref} 的工单行`)
  return row
}

function blockerFor(ref: string): HTMLElement {
  const item = [
    ...mustFind('detail-blockers').querySelectorAll<HTMLElement>('[data-testid="blocker-item"]'),
  ].find((element) => element.getAttribute('data-ref') === ref)
  if (item === undefined) throw new Error(`缺少阻塞项 ${ref}`)
  return item
}

function pressEscape(): Promise<void> {
  return settleWith(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  })
}

const PREFERENCE_STORE = new Map<string, unknown>()

beforeEach(() => {
  setupDom()
  PREFERENCE_STORE.clear()
  // 视图偏好存在宿主私有存储里；给它一份内存实现，返回列表时筛选才能保留。
  window.orca = {
    storage: {
      get: async (key: string) => PREFERENCE_STORE.get(key),
      set: async (key: string, value: unknown) => {
        PREFERENCE_STORE.set(key, value)
      },
      delete: async (key: string) => {
        PREFERENCE_STORE.delete(key)
      },
      keys: async () => [...PREFERENCE_STORE.keys()],
    },
  } as unknown as NonNullable<Window['orca']>
})

afterEach(async () => {
  await teardownDom()
  delete window.orca
})

describe('详情里的阻塞项导航', () => {
  it('从列表打开被阻塞票，跳到阻塞票后逐层返回列表', async () => {
    const get = vi.fn<PanelClient['get']>(async () => ok(SNAPSHOT))
    const getDetail = vi.fn<PanelClient['getDetail']>(async (_root, ref, number) =>
      ok(makeDetail({ ref, number, title: `详情 ${ref}` })),
    )
    const copy = vi.fn(async () => ({ outcome: 'copied' as const, reason: null }))
    await render(
      <TaskPanel
        client={clientWith({ get, getDetail })}
        workspaceRoot="/ws"
        copy={{ canCopy: true, copy }}
      />,
    )

    await click(mustFind('filter-blocked'))
    await settle()
    expect(rowFor('#2')).not.toBeNull()
    await click(rowFor('#2'))

    expect(mustFind('detail-ref').textContent).toBe('#2')
    expect(mustFind('detail-back').textContent).toContain('返回列表')

    await click(mustFind('blockers-toggle'))
    await click(blockerFor('#1'))

    expect(mustFind('detail-ref').textContent).toBe('#1')
    expect(getDetail.mock.calls).toEqual([
      ['/ws', '#2', 2],
      ['/ws', '#1', 1],
    ])
    expect(mustFind('detail-back').textContent).toContain('返回 #2')

    await click(mustFind('detail-back'))

    expect(mustFind('detail-ref').textContent).toBe('#2')
    expect(mustFind('detail-back').textContent).toContain('返回列表')
    // 从返回栈回到被阻塞票也算重新打开：阻塞项收起，需要时再展开。
    expect(find('detail-blockers')).toBeNull()
    expect(mustFind('blockers-toggle').getAttribute('aria-expanded')).toBe('false')

    await click(mustFind('detail-back'))

    expect(find('ticket-row')).not.toBeNull()
    expect(mustFind('filter-blocked').getAttribute('aria-pressed')).toBe('true')
    // 浏览阻塞项只导航，不重复拉快照，也不往会话输入框写提示词。
    expect(get).toHaveBeenCalledTimes(1)
    expect(copy).not.toHaveBeenCalled()
  })

  it('按引用打开不在当前快照里的阻塞票', async () => {
    const snapshot = makeSnapshot({
      tickets: SNAPSHOT.tickets.map((ticket) =>
        ticket.ref === '#2' ? { ...ticket, blockedBy: ['#9'] } : ticket,
      ),
    })
    const getDetail = vi.fn<PanelClient['getDetail']>(async (_root, ref, number) =>
      ok(makeDetail({ ref, number, title: `详情 ${ref}` })),
    )
    await render(
      <TaskPanel
        client={clientWith({ get: async () => ok(snapshot), getDetail })}
        workspaceRoot="/ws"
        copy={COPY}
      />,
    )

    await click(rowFor('#2'))
    await click(mustFind('blockers-toggle'))

    const blocker = blockerFor('#9')
    expect(blocker.textContent).toContain('未加载')
    await click(blocker)

    expect(mustFind('detail-ref').textContent).toBe('#9')
    expect(getDetail.mock.calls).toEqual([
      ['/ws', '#2', 2],
      ['/ws', '#9', 9],
    ])
    // 没有列表快照行：不编造技能徽标与阻塞入口。
    expect(find('skill-badge')).toBeNull()
    expect(find('action-reason')).toBeNull()
    expect(find('blockers-toggle')).toBeNull()
    expect(mustFind('detail-back').textContent).toContain('返回 #2')
  })

  it('Esc 与返回按钮走同一条返回路径', async () => {
    await render(<TaskPanel client={clientWith()} workspaceRoot="/ws" copy={COPY} />)

    await click(rowFor('#2'))
    await click(mustFind('blockers-toggle'))
    await click(blockerFor('#1'))
    expect(mustFind('detail-ref').textContent).toBe('#1')

    await pressEscape()
    expect(mustFind('detail-ref').textContent).toBe('#2')

    await pressEscape()
    expect(find('ticket-row')).not.toBeNull()
    expect(find('detail-content')).toBeNull()
  })

  it('详情刷新后返回栈保留，阻塞项标题跟着快照更新', async () => {
    const retitled = makeSnapshot({
      ...SNAPSHOT,
      tickets: SNAPSHOT.tickets.map((ticket) =>
        ticket.ref === '#1' ? { ...ticket, title: 'Bravo 改过标题' } : ticket,
      ),
    })
    const refresh = vi.fn<PanelClient['refresh']>(async () => ok(retitled))
    await render(
      <TaskPanel client={clientWith({ refresh })} workspaceRoot="/ws" copy={COPY} />,
    )

    await click(rowFor('#2'))
    await click(mustFind('blockers-toggle'))
    await click(blockerFor('#1'))
    expect(mustFind('detail-ref').textContent).toBe('#1')

    // 在阻塞票上刷新：返回栈保留，快照落地后回到被阻塞票仍能看到新的阻塞项标题。
    await click(mustFind('detail-refresh'))
    expect(refresh).toHaveBeenCalledWith('/ws')
    expect(mustFind('detail-back').textContent).toContain('返回 #2')

    await click(mustFind('detail-back'))
    await click(mustFind('blockers-toggle'))
    expect(blockerFor('#1').textContent).toContain('Bravo 改过标题')
    expect(mustFind('detail-back').textContent).toContain('返回列表')
  })

  it('详情刷新拿到未定稿快照时继续补齐阻塞信息', async () => {
    const unfinalized = makeSnapshot({
      ...SNAPSHOT,
      blockersFinalized: false,
      tickets: SNAPSHOT.tickets.map((ticket) => {
        if (ticket.ref === '#1') return { ...ticket, title: 'Bravo 改过标题' }
        if (ticket.ref !== '#2') return ticket
        // 列表阶段的 GitLab 快照还没有原生阻塞边：先按未阻塞落地。
        const { blockedBy: _omitted, ...without } = ticket
        return {
          ...without,
          status: 'ready',
          skillAction: 'implement',
          skillActionReason: 'ready-for-agent',
          openBlockers: 0,
        }
      }),
    })
    const finalized = makeSnapshot({
      ...SNAPSHOT,
      tickets: SNAPSHOT.tickets.map((ticket) =>
        ticket.ref === '#1' ? { ...ticket, title: 'Bravo 改过标题' } : ticket,
      ),
    })
    const refresh = vi.fn<PanelClient['refresh']>(async () => ok(unfinalized))
    const resolveBlockers = vi.fn<PanelClient['resolveBlockers']>(async () => ok(finalized))
    await render(
      <TaskPanel
        client={clientWith({ refresh, resolveBlockers })}
        workspaceRoot="/ws"
        copy={COPY}
      />,
    )

    await click(rowFor('#2'))
    await click(mustFind('blockers-toggle'))
    expect(blockerFor('#1').textContent).toContain('Bravo')

    await click(mustFind('detail-refresh'))
    await settle()

    // 未定稿快照按原样落地后，面板继续补齐，入口与展开块恢复并跟上新标题。
    expect(resolveBlockers).toHaveBeenCalledWith('/ws')
    expect(mustFind('blockers-toggle').textContent).toContain('阻塞 1')
    expect(find('detail-blockers')).not.toBeNull()
    expect(blockerFor('#1').textContent).toContain('Bravo 改过标题')
  })

  it('阻塞信息在后台补齐后入口自动变成可展开', async () => {
    const pending = makeSnapshot({
      tickets: SNAPSHOT.tickets.map((ticket) => {
        if (ticket.ref !== '#2') return ticket
        const { blockedBy: _omitted, ...without } = ticket
        return without
      }),
      blockersFinalized: false,
    })
    const finalize = deferred<RpcResult<WorkspaceSnapshot>>()
    await render(
      <TaskPanel
        client={clientWith({
          get: async () => ok(pending),
          resolveBlockers: () => finalize.promise,
        })}
        workspaceRoot="/ws"
        copy={COPY}
      />,
    )

    await click(rowFor('#2'))
    expect(find('blockers-toggle')).toBeNull()
    expect(mustFind('action-reason').textContent).toContain('阻塞 1')

    await settleWith(() => {
      finalize.resolve(ok(SNAPSHOT))
    })

    expect(mustFind('blockers-toggle').textContent).toContain('阻塞 1')
  })

  it('切换工作区后返回栈清空', async () => {
    const get = vi.fn<PanelClient['get']>(async (workspaceRoot: string) =>
      ok(makeSnapshot({ ...SNAPSHOT, repository: `${workspaceRoot}/repo` })),
    )
    const client = clientWith({ get })
    await render(<TaskPanel client={client} workspaceRoot="/one" copy={COPY} />)

    await click(rowFor('#2'))
    await click(mustFind('blockers-toggle'))
    await click(blockerFor('#1'))
    expect(mustFind('detail-ref').textContent).toBe('#1')

    await render(<TaskPanel client={client} workspaceRoot="/two" copy={COPY} />)
    expect(mustFind('repo-name').textContent).toBe('/two/repo')

    // 回到旧工作区时旧详情可以重新打开，但上一个仓库的票不再充当“上一张”。
    await render(<TaskPanel client={client} workspaceRoot="/one" copy={COPY} />)
    expect(mustFind('detail-ref').textContent).toBe('#1')
    expect(mustFind('detail-back').textContent).toContain('返回列表')
  })

  it('从页签栏回列表后，再次打开详情从列表开始', async () => {
    await render(<TaskPanel client={clientWith()} workspaceRoot="/ws" copy={COPY} />)

    await click(rowFor('#2'))
    await click(mustFind('blockers-toggle'))
    await click(blockerFor('#1'))
    expect(mustFind('detail-ref').textContent).toBe('#1')

    await click(mustFind('view-tickets'))
    await click(rowFor('#2'))

    expect(mustFind('detail-back').textContent).toContain('返回列表')
  })

  it('跳到阻塞票时不保留上一张的写操作状态', async () => {
    const updateTicket = vi.fn<PanelClient['updateTicket']>(async () => ({
      ok: false as const,
      error: { code: 'fetch-failed' as const, message: '写失败' },
    }))
    await render(
      <TaskPanel client={clientWith({ updateTicket })} workspaceRoot="/ws" copy={COPY} />,
    )

    await click(rowFor('#2'))
    await click(mustFind('detail-state-toggle'))
    expect(mustFind('detail-error').textContent).toContain('写失败')

    await click(mustFind('blockers-toggle'))
    await click(blockerFor('#1'))

    expect(mustFind('detail-ref').textContent).toBe('#1')
    expect(find('detail-error')).toBeNull()
  })
})
