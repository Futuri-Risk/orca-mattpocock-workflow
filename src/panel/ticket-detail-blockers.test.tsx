// @vitest-environment happy-dom
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MESSAGES } from '../protocol/i18n.ts'
import type { TicketSnapshot } from '../protocol/tracker.ts'
import {
  button,
  click,
  find,
  mustFind,
  render,
  setupDom,
  teardownDom,
} from './dom-test-support.ts'
import { clearDetailCache } from './detail-cache.ts'
import type { PromptCopy } from './injection.ts'
import type { TicketDetailViewProps } from './ticket-detail-view.tsx'
import { TicketDetailView } from './ticket-detail-view.tsx'
import { makeDetail, makeSnapshot, makeTicket, ok } from './ticket-detail-test-support.ts'
import type { PanelClient } from './transport.ts'

const ZH = MESSAGES['zh-CN']
const COPY: PromptCopy = {
  canCopy: true,
  copy: async () => ({ outcome: 'copied', reason: null }),
}

/** 只实现详情视图会走到的入口；其余方法不会被调用。 */
function clientWith(): PanelClient {
  return {
    getDetail: async (_workspaceRoot: string, ref: string, number: number | null) =>
      ok(makeDetail({ ref, number, title: `详情 ${ref}` })),
    refresh: async () => ok(makeSnapshot()),
    getOptions: async () => ok({ labels: [], assignees: [] }),
    updateTicket: async () => ok({ applied: true }),
    deleteTicket: async () => ok({ deleted: true }),
  } as unknown as PanelClient
}

function view(overrides: Partial<TicketDetailViewProps> = {}): ReactElement {
  return (
    <TicketDetailView
      client={clientWith()}
      workspaceRoot="/ws"
      target={{ ref: '#18', number: 18, ticket: makeTicket() }}
      snapshotTickets={[makeTicket()]}
      copy={COPY}
      backRef={null}
      onBack={() => undefined}
      onOpenBlocker={() => undefined}
      onSnapshot={() => undefined}
      baseline={null}
      onOpenEnvCheck={() => undefined}
      {...overrides}
    />
  )
}

beforeEach(() => {
  clearDetailCache()
  setupDom()
})

afterEach(async () => {
  await teardownDom()
})

const BLOCKER_OPEN = makeTicket({
  ref: '#3',
  number: 3,
  title: 'Alpha',
  state: 'open',
  status: 'open',
  skillAction: 'none',
  skillActionReason: 'untriaged',
})

const BLOCKER_CLOSED = makeTicket({
  ref: '#4',
  number: 4,
  title: 'Done',
  state: 'closed',
  status: 'closed',
  skillAction: 'none',
  skillActionReason: 'closed',
})

/** 一张被阻塞的票；refs 为 null 表示快照行没有 blockedBy（GitHub 只有计数）。 */
function blocked(
  overrides: Partial<TicketSnapshot> = {},
  refs: readonly string[] | null = ['#3', '#3', '#4', '#9'],
): TicketSnapshot {
  return makeTicket({
    status: 'blocked',
    skillAction: 'none',
    skillActionReason: 'blocked',
    openBlockers: 2,
    ...overrides,
    ...(refs === null ? {} : { blockedBy: refs }),
  })
}

function blockerItem(ref: string): HTMLElement {
  const item = [...mustFind('detail-blockers').querySelectorAll<HTMLElement>('[data-testid="blocker-item"]')].find(
    (element) => element.getAttribute('data-ref') === ref,
  )
  if (item === undefined) throw new Error(`缺少阻塞项 ${ref}`)
  return item
}

function renderBlocked(overrides: Partial<TicketDetailViewProps> = {}): Promise<void> {
  const ticket = blocked()
  return render(
    view({
      target: { ref: ticket.ref, number: ticket.number, ticket },
      snapshotTickets: [ticket, BLOCKER_OPEN, BLOCKER_CLOSED],
      ...overrides,
    }),
  )
}

describe('详情里的阻塞项', () => {
  it('展开「阻塞 N」列出未关闭且去重后的阻塞项，再点收起', async () => {
    await renderBlocked()

    const toggle = button('blockers-toggle')
    expect(toggle.textContent).toContain(ZH['skill.action.blocked'].replace('{n}', '2'))
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(find('detail-blockers')).toBeNull()

    await click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const section = mustFind('detail-blockers')
    expect(section.id).toBe(toggle.getAttribute('aria-controls'))
    const items = [...section.querySelectorAll<HTMLElement>('[data-testid="blocker-item"]')]
    // #3 重复只出现一次；#4 已关闭被排除；#9 不在快照里但保留引用。
    expect(items.map((item) => item.getAttribute('data-ref'))).toEqual(['#3', '#9'])
    expect(blockerItem('#3').querySelector('[data-testid="blocker-title"]')?.textContent).toBe(
      'Alpha',
    )
    expect(blockerItem('#3').querySelector('[data-testid="blocker-state"]')?.textContent).toBe(
      ZH['status.open'],
    )
    expect(blockerItem('#9').querySelector('[data-testid="blocker-unloaded"]')?.textContent).toBe(
      ZH['detail.blockers.unloaded'],
    )
    expect(blockerItem('#9').querySelector('[data-testid="blocker-title"]')).toBeNull()

    await click(toggle)

    expect(find('detail-blockers')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('点击阻塞项只把引用交给面板，不复制提示词', async () => {
    const copy = vi.fn(async () => ({ outcome: 'copied' as const, reason: null }))
    const onOpenBlocker = vi.fn()
    await renderBlocked({ copy: { canCopy: true, copy }, onOpenBlocker })

    await click(button('blockers-toggle'))
    await click(blockerItem('#3'))

    expect(onOpenBlocker).toHaveBeenCalledWith('#3')
    expect(copy).not.toHaveBeenCalled()
  })

  it('没有阻塞引用时保持只读徽标，不出现可点击入口', async () => {
    const ticket = blocked({ openBlockers: 2 }, null)
    await render(
      view({
        target: { ref: ticket.ref, number: ticket.number, ticket },
        snapshotTickets: [ticket],
      }),
    )

    expect(find('blockers-toggle')).toBeNull()
    expect(mustFind('action-reason').textContent).toBe(
      ZH['skill.action.blocked'].replace('{n}', '2'),
    )
    expect(mustFind('action-reason').getAttribute('title')).toContain(ZH['skill.hint.blocked'])
  })

  it('引用全部已关闭时不展开空面板，入口保持只读', async () => {
    const ticket = blocked({ openBlockers: 1 }, ['#4'])
    await render(
      view({
        target: { ref: ticket.ref, number: ticket.number, ticket },
        snapshotTickets: [ticket, BLOCKER_CLOSED],
      }),
    )

    expect(find('blockers-toggle')).toBeNull()
    expect(mustFind('action-reason').textContent).toBe(
      ZH['skill.action.blocked'].replace('{n}', '1'),
    )
  })

  it('换一张票时展开状态重置', async () => {
    const first = blocked()
    await render(
      view({
        target: { ref: first.ref, number: first.number, ticket: first },
        snapshotTickets: [first, BLOCKER_OPEN],
      }),
    )
    await click(button('blockers-toggle'))
    expect(find('detail-blockers')).not.toBeNull()

    const second = blocked({ ref: '#26', number: 26, openBlockers: 1 }, ['#3'])
    await render(
      view({
        target: { ref: second.ref, number: second.number, ticket: second },
        snapshotTickets: [second, BLOCKER_OPEN],
      }),
    )

    expect(find('detail-blockers')).toBeNull()
    expect(button('blockers-toggle').getAttribute('aria-expanded')).toBe('false')
  })

  it('快照补齐阻塞引用后入口从只读变成可展开', async () => {
    const pending = blocked({ openBlockers: 1 }, null)
    await render(
      view({
        target: { ref: pending.ref, number: pending.number, ticket: pending },
        snapshotTickets: [pending],
      }),
    )
    expect(find('blockers-toggle')).toBeNull()

    const finalized = blocked({ openBlockers: 1 }, ['#3'])
    await render(
      view({
        target: { ref: finalized.ref, number: finalized.number, ticket: finalized },
        snapshotTickets: [finalized, BLOCKER_OPEN],
      }),
    )

    expect(button('blockers-toggle').textContent).toContain(
      ZH['skill.action.blocked'].replace('{n}', '1'),
    )
  })

  it('有上一张票时返回按钮显示它的引用', async () => {
    await render(view({ backRef: '#2' }))

    const back = mustFind('detail-back')
    expect(back.textContent).toContain(ZH['detail.backTo'].replace('{ref}', '#2'))
    expect(back.getAttribute('title')).toBe(ZH['detail.backToTitle'].replace('{ref}', '#2'))
  })

  it('按引用打开、快照里没有这张票时不渲染技能徽标与阻塞入口', async () => {
    await render(
      view({
        target: { ref: '#9', number: 9, ticket: null },
        snapshotTickets: [],
      }),
    )

    expect(mustFind('detail-ref').textContent).toBe('#9')
    expect(find('skill-badge')).toBeNull()
    expect(find('action-reason')).toBeNull()
    expect(find('blockers-toggle')).toBeNull()
  })
})
