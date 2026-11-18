// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MESSAGES } from '../protocol/i18n.ts'
import {
  TICKET_DELETE_CONFIRMATION,
  type RpcResult,
  type TicketDetail,
  type WorkspaceSnapshot,
} from '../protocol/tracker.ts'
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

const ZH = MESSAGES['zh-CN']
const COPY: PromptCopy = {
  canCopy: true,
  copy: async () => ({ outcome: 'copied', reason: null }),
}

interface PanelClientOptions {
  readonly get: PanelClient['get']
  readonly getDetail: PanelClient['getDetail']
  readonly refresh: PanelClient['refresh']
  readonly deleteTicket?: PanelClient['deleteTicket']
}

/** 只实现面板用例会走到的入口。 */
function clientWith(options: PanelClientOptions): PanelClient {
  return {
    ...options,
    getOptions: async () => ok({ labels: [], assignees: [] }),
    loadMore: async () => ok(makeSnapshot()),
    resolveBlockers: async () => ok(makeSnapshot()),
  } as unknown as PanelClient
}

/** 按引用找列表行。 */
function rowFor(ref: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('[data-testid="ticket-row"]')].find(
    (element) => element.getAttribute('data-ref') === ref,
  )
  if (row === undefined) throw new Error(`缺少 ${ref} 的工单行`)
  return row
}

/** 把输入框改成指定值；绕开 React 对实例 value 的追踪。 */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await settleWith(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  setupDom()
})

afterEach(async () => {
  await teardownDom()
})

describe('任务面板的详情刷新', () => {
  it('刷新后的快照按 ref 匹配同一行，技能徽标跟着新状态变化', async () => {
    const ticket = makeTicket()
    const closed = makeTicket({
      state: 'closed',
      status: 'closed',
      skillAction: 'none',
      skillActionReason: 'closed',
    })
    const get = vi.fn<PanelClient['get']>(async () =>
      ok(makeSnapshot({ tickets: [ticket] })),
    )
    const getDetail = vi.fn<PanelClient['getDetail']>(async () => ok(makeDetail()))
    const refresh = vi.fn<PanelClient['refresh']>(async () =>
      ok(makeSnapshot({ tickets: [closed] })),
    )
    await render(
      <TaskPanel client={clientWith({ get, getDetail, refresh })} workspaceRoot="/a" copy={COPY} />,
    )

    await click(mustFind('ticket-row'))
    expect(find('skill-badge')).not.toBeNull()

    await click(mustFind('detail-refresh'))

    expect(refresh).toHaveBeenCalledWith('/a')
    expect(find('skill-badge')).toBeNull()
    const reason = mustFind('action-reason')
    expect(reason.getAttribute('data-ref')).toBe('#18')
    expect(reason.textContent).toBe(ZH['skill.action.closed'])
  })

  it('切换工作区后，旧工作区还在路上的刷新结果不写进新工作区', async () => {
    const staleDetail = deferred<RpcResult<TicketDetail>>()
    const staleSnapshot = deferred<RpcResult<WorkspaceSnapshot>>()
    const snapshotA = makeSnapshot({ tickets: [makeTicket({ title: 'A 票' })] })
    const snapshotB = makeSnapshot({
      repository: 'acme/other',
      tickets: [makeTicket({ ref: '#20', number: 20, title: 'B 票' })],
    })
    const get = vi.fn<PanelClient['get']>(async (workspaceRoot: string) =>
      ok(workspaceRoot === '/a' ? snapshotA : snapshotB),
    )
    const getDetail = vi
      .fn<PanelClient['getDetail']>()
      .mockResolvedValueOnce(ok(makeDetail({ title: 'A 票' })))
      .mockReturnValueOnce(staleDetail.promise)
    const refresh = vi
      .fn<PanelClient['refresh']>()
      .mockReturnValueOnce(staleSnapshot.promise)
    const client = clientWith({ get, getDetail, refresh })
    await render(<TaskPanel client={client} workspaceRoot="/a" copy={COPY} />)

    await click(mustFind('ticket-row'))
    await click(mustFind('detail-refresh'))

    await render(<TaskPanel client={client} workspaceRoot="/b" copy={COPY} />)
    expect(document.body.textContent).toContain('B 票')

    await settleWith(() => {
      staleDetail.resolve(ok(makeDetail({ title: 'STALE 旧仓库' })))
      staleSnapshot.resolve(ok(snapshotA))
    })

    expect(find('ticket-detail')).toBeNull()
    expect(document.body.textContent).not.toContain('STALE 旧仓库')
    expect(document.body.textContent).toContain('B 票')
    expect(document.body.textContent).not.toContain('A 票')
  })
})

describe('删除后的共享快照', () => {
  it('删除工单后回到列表，已删除的行不再出现', async () => {
    const doomed = makeTicket({ ref: '#18', number: 18, title: '要删的票' })
    const kept = makeTicket({ ref: '#19', number: 19, title: '留下的票' })
    const get = vi.fn<PanelClient['get']>(async () =>
      ok(makeSnapshot({ tickets: [doomed, kept] })),
    )
    const getDetail = vi.fn<PanelClient['getDetail']>(async () =>
      ok(
        makeDetail({
          ref: '#18',
          number: 18,
          title: '要删的票',
          capabilities: {
            labels: false,
            assignees: false,
            state: false,
            link: false,
            delete: true,
          },
        }),
      ),
    )
    const refresh = vi.fn<PanelClient['refresh']>(async () =>
      ok(makeSnapshot({ tickets: [kept] })),
    )
    const deleteTicket = vi.fn<PanelClient['deleteTicket']>(async () =>
      ok({ deleted: true as const }),
    )
    await render(
      <TaskPanel
        client={clientWith({ get, getDetail, refresh, deleteTicket })}
        workspaceRoot="/ws"
        copy={COPY}
      />,
    )

    await click(rowFor('#18'))
    await click(mustFind('detail-more'))
    await click(mustFind('detail-delete'))
    await typeInto(
      mustFind('delete-confirm-input') as HTMLInputElement,
      TICKET_DELETE_CONFIRMATION,
    )
    await click(mustFind('delete-submit'))
    await settle()

    expect(deleteTicket).toHaveBeenCalledWith('/ws', '#18', 18)
    expect(refresh).toHaveBeenCalledWith('/ws')
    expect(find('ticket-detail')).toBeNull()
    expect(rowFor('#19')).not.toBeNull()
    expect(document.querySelector('[data-testid="ticket-row"][data-ref="#18"]')).toBeNull()
  })
})

describe('标题的键盘入口', () => {
  it.each(['Enter', ' '])('标题块按 %j 打开详情', async (key) => {
    const get = vi.fn<PanelClient['get']>(async () =>
      ok(makeSnapshot({ tickets: [makeTicket()] })),
    )
    const getDetail = vi.fn<PanelClient['getDetail']>(async () => ok(makeDetail()))
    const refresh = vi.fn<PanelClient['refresh']>(async () => ok(makeSnapshot()))
    await render(
      <TaskPanel
        client={clientWith({ get, getDetail, refresh })}
        workspaceRoot="/a"
        copy={COPY}
      />,
    )

    const row = mustFind('ticket-row')
    expect(row.getAttribute('role')).toBe('button')
    expect(row.tabIndex).toBe(0)
    row.focus()
    await act(async () => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    })
    await settle()

    expect(getDetail).toHaveBeenCalled()
    expect(find('ticket-detail')).not.toBeNull()
  })
})
