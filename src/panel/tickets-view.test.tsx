// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MESSAGES } from '../protocol/i18n.ts'
import type { SnapshotRequestState } from './snapshot-request.ts'
import { PeopleFilterRow, TicketsView } from './tickets-view.tsx'
import {
  button,
  click,
  find,
  mustFind,
  render as mount,
  setupDom,
  teardownDom,
} from './dom-test-support.ts'
import { makeSnapshot, makeTicket } from './ticket-detail-test-support.ts'
import { createPanelClient } from './transport.ts'

const ZH = MESSAGES['zh-CN']
const NOW = Date.parse('2026-06-01T00:00:00Z')

function render(
  people: { readonly assignedToMe: boolean; readonly createdByMe: boolean },
  viewer: string | null = 'cnzgray',
): string {
  return renderToStaticMarkup(
    <PeopleFilterRow
      viewer={viewer}
      people={people}
      counts={{ assignedToMe: 3, createdByMe: 2 }}
      onToggle={() => undefined}
      onClear={() => undefined}
    />,
  )
}

describe('人员筛选行', () => {
  it('当前用户为 null 时整行不渲染', () => {
    expect(render({ assignedToMe: false, createdByMe: false }, null)).toBe('')
  })

  it('渲染两个带计数的开关与当前身份', () => {
    const markup = render({ assignedToMe: false, createdByMe: false })

    expect(markup).toContain(`aria-label="${ZH['tickets.people.group']}"`)
    expect(markup).toContain(`data-testid="people-assigned"`)
    expect(markup).toContain(`data-testid="people-created"`)
    expect(markup).toContain(ZH['tickets.people.assigned'])
    expect(markup).toContain(ZH['tickets.people.created'])
    expect(markup).toContain('@cnzgray')
    expect(markup.split('aria-pressed="false"').length - 1).toBe(2)
    expect(markup).toContain('>3<')
    expect(markup).toContain('>2<')
  })

  it('两个开关都关时不显示「清除」', () => {
    const markup = render({ assignedToMe: false, createdByMe: false })

    expect(markup).not.toContain('data-testid="people-clear"')
    expect(markup).not.toContain(ZH['tickets.people.clear'])
  })

  it('任一开关打开时显示「清除」，并标记对应的按下状态', () => {
    const markup = render({ assignedToMe: true, createdByMe: false })

    expect(markup).toContain('data-testid="people-clear"')
    expect(markup).toContain(ZH['tickets.people.clear'])
    expect(markup).toMatch(/data-testid="people-assigned"[^>]*aria-pressed="true"/u)
    expect(markup).toMatch(/data-testid="people-created"[^>]*aria-pressed="false"/u)
  })

  it('两个都开时两个开关都按下，清除仍然只出现一次', () => {
    const markup = render({ assignedToMe: true, createdByMe: true })

    expect(markup.split('aria-pressed="true"').length - 1).toBe(2)
    expect(markup.split('data-testid="people-clear"').length - 1).toBe(1)
  })

  it('悬停说明写清计数按当前状态筛选统计', () => {
    const markup = render({ assignedToMe: false, createdByMe: false })

    expect(markup).toContain(`title="${ZH['tickets.people.assignedHint']}"`)
    expect(markup).toContain(`title="${ZH['tickets.people.createdHint']}"`)
    expect(ZH['tickets.people.assignedHint']).toContain('状态筛选')
  })

  it('身份说明带完整登录名', () => {
    const markup = render({ assignedToMe: false, createdByMe: false })

    expect(markup).toContain(`title="${ZH['tickets.people.viewerHint'].replace('{login}', 'cnzgray')}"`)
  })
})

describe('行内信息菜单', () => {
  beforeEach(() => {
    setupDom()
  })

  afterEach(async () => {
    await teardownDom()
  })

  function view() {
    const ticket = makeTicket({
      assignees: ['alice'],
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-02T00:00:00Z',
    })
    const request: SnapshotRequestState = {
      snapshot: makeSnapshot({ tickets: [ticket] }),
      error: null,
      refreshError: null,
      phase: 'ready',
      refresh: () => undefined,
      refreshFull: () => undefined,
      applyRefresh: () => undefined,
      appending: false,
      loadMore: () => undefined,
    }
    return (
      <TicketsView
        client={createPanelClient(() => Promise.reject(new Error('菜单测试不应发请求')))}
        workspaceRoot="/workspace"
        copy={{
          canCopy: true,
          copy: () => Promise.resolve({ outcome: 'copied', reason: null }),
        }}
        now={() => NOW}
        request={request}
        onOpenEnvCheck={() => undefined}
        onOpenTicket={() => undefined}
      />
    )
  }

  it('默认行内没有更新时间与分配人，打开菜单后各自独立出现与消失', async () => {
    await mount(view())

    expect(find('ticket-updated-at')).toBeNull()
    expect(find('ticket-assignee')).toBeNull()

    await click(button('row-details'))
    const trigger = button('row-details')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.textContent).toContain(ZH['tickets.rowDetails'])
    expect(button('row-details-updated').getAttribute('aria-checked')).toBe('false')
    expect(button('row-details-assignee').getAttribute('aria-checked')).toBe('false')
    expect(button('row-details-updated').textContent).toContain(
      ZH['tickets.rowDetails.updatedAt'],
    )

    await click(button('row-details-updated'))
    expect(button('row-details-updated').getAttribute('aria-checked')).toBe('true')
    const updated = mustFind('ticket-updated-at')
    expect(updated.textContent).toContain('30 天前')
    expect(updated.textContent).toContain(
      ZH['tickets.updatedAtLabel'].replace('{time}', '30 天前'),
    )
    expect(find('ticket-assignee')).toBeNull()

    await click(button('row-details-assignee'))
    expect(button('row-details-assignee').getAttribute('aria-checked')).toBe('true')
    const assignee = mustFind('ticket-assignee')
    expect(assignee.textContent).toContain('@alice')
    expect(assignee.textContent).toContain(
      ZH['tickets.assigneeLabel'].replace('{login}', '@alice'),
    )

    await click(button('row-details-updated'))
    expect(button('row-details-updated').getAttribute('aria-checked')).toBe('false')
    expect(find('ticket-updated-at')).toBeNull()
    expect(find('ticket-assignee')).not.toBeNull()
  })
})
