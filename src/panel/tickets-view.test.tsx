// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MESSAGES } from '../protocol/i18n.ts'
import type { TicketSnapshot, WorkspaceSnapshot } from '../protocol/tracker.ts'
import type { SnapshotRequestState } from './snapshot-request.ts'
import { PeopleFilterRow, TicketsView } from './tickets-view.tsx'
import {
  button,
  click,
  find,
  flush,
  keyDown,
  mustFind,
  pointerDown,
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

/** 菜单测试的默认工单：有创建人和更新时间，便于同时验证四个开关。 */
function menuTicket(overrides: Partial<TicketSnapshot> = {}): TicketSnapshot {
  return makeTicket({
    assignees: ['alice'],
    author: { login: 'alice', displayName: 'Alice', avatarUrl: null },
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-02T00:00:00Z',
    ...overrides,
  })
}

function view(
  options: {
    readonly backend?: WorkspaceSnapshot['backend']
    readonly tickets?: readonly TicketSnapshot[]
    readonly onOpenTicket?: (ticket: TicketSnapshot) => void
    readonly request?: (name: string, input: unknown) => Promise<unknown>
  } = {},
) {
  const snapshot = makeSnapshot({
    tickets: options.tickets ?? [menuTicket()],
    ...(options.backend === undefined ? {} : { backend: options.backend }),
  })
  const request: SnapshotRequestState = {
    snapshot,
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
      client={createPanelClient(
        options.request ?? (() => Promise.reject(new Error('菜单测试不应发请求'))),
      )}
      workspaceRoot="/workspace"
      copy={{
        canCopy: true,
        copy: () => Promise.resolve({ outcome: 'copied', reason: null }),
      }}
      now={() => NOW}
      request={request}
      onOpenEnvCheck={() => undefined}
      onOpenTicket={options.onOpenTicket ?? (() => undefined)}
    />
  )
}

describe('行内显示菜单', () => {
  beforeEach(() => {
    setupDom()
  })

  afterEach(async () => {
    await teardownDom()
    Reflect.deleteProperty(window, 'orca')
  })

  it('默认显示创建人与创建时间，浮层里四个开关状态正确', async () => {
    await mount(view())

    expect(mustFind('ticket-age').textContent).toBe('31 天前')
    expect(find('ticket-assignees')).toBeNull()

    await click(button('display-settings'))
    const trigger = button('display-settings')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.getAttribute('aria-label')).toBe(ZH['tickets.row.trigger'])
    expect(button('display-author').getAttribute('aria-pressed')).toBe('true')
    expect(button('display-created').getAttribute('aria-pressed')).toBe('true')
    expect(button('display-updated').getAttribute('aria-pressed')).toBe('false')
    expect(button('display-assignees').getAttribute('aria-pressed')).toBe('false')
    expect(button('display-author').textContent).toContain(ZH['tickets.row.author'])
  })

  it('打开更新时间与分配人后各自出现，创建人不受影响', async () => {
    await mount(view())
    await click(button('display-settings'))

    await click(button('display-updated'))
    expect(button('display-updated').getAttribute('aria-pressed')).toBe('true')
    expect(mustFind('ticket-age').textContent).toBe('创建 31 天前 · 更新 30 天前')
    expect(mustFind('ticket-author').textContent).toBe('Alice')

    await click(button('display-assignees'))
    expect(button('display-assignees').getAttribute('aria-pressed')).toBe('true')
    const assignees = mustFind('ticket-assignees')
    expect(assignees.textContent).toContain('alice')
    expect(assignees.textContent).not.toContain('@alice')
  })

  it('关闭创建人后时间带「创建」前缀，关闭创建时间后时间区消失', async () => {
    await mount(view())
    await click(button('display-settings'))

    await click(button('display-author'))
    expect(find('ticket-author')).toBeNull()
    expect(mustFind('ticket-age').textContent).toBe('创建 31 天前')

    await click(button('display-created'))
    expect(find('ticket-age')).toBeNull()
  })

  it('本地 Markdown 后端不出现分配人开关，更新时间开关仍在', async () => {
    await mount(view({ backend: 'markdown' }))
    await click(button('display-settings'))

    expect(find('display-assignees')).toBeNull()
    expect(mustFind('display-updated')).not.toBeNull()
  })

  it('Esc 收起浮层并把焦点还给入口', async () => {
    await mount(view())
    await click(button('display-settings'))

    await keyDown(document, 'Escape')

    expect(find('display-updated')).toBeNull()
    expect(button('display-settings').getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button('display-settings'))
  })

  it('点浮层以外收起', async () => {
    await mount(view())
    await click(button('display-settings'))

    await pointerDown(document.body)

    expect(find('display-updated')).toBeNull()
  })

  it('点开关不打开详情', async () => {
    const opened: string[] = []
    await mount(
      view({
        onOpenTicket: (picked) => {
          opened.push(picked.ref)
        },
      }),
    )
    await click(button('display-settings'))
    await click(button('display-updated'))

    expect(opened).toEqual([])
  })

  it('切换开关不改变筛选与排序，也不发起请求', async () => {
    const request = vi.fn(() => Promise.reject(new Error('不应发请求')))
    await mount(
      view({
        tickets: [
          menuTicket({ ref: '#1', number: 1, title: 'A' }),
          menuTicket({ ref: '#2', number: 2, title: 'B', status: 'closed' }),
        ],
        request,
      }),
    )
    const refs = (): readonly (string | null)[] =>
      [...document.querySelectorAll('[data-testid="ticket-row"]')].map((row) =>
        row.getAttribute('data-ref'),
      )
    const before = refs()

    await click(button('display-settings'))
    await click(button('display-updated'))
    await click(button('display-assignees'))

    expect(request).not.toHaveBeenCalled()
    expect(button('filter-open').getAttribute('aria-pressed')).toBe('true')
    expect((mustFind('sort-key') as HTMLSelectElement).value).toBe('status')
    expect(refs()).toEqual(before)
  })

  it('开关按仓库持久化，重新挂载后恢复', async () => {
    const data = new Map<string, unknown>()
    Object.defineProperty(window, 'orca', {
      configurable: true,
      value: {
        storage: {
          get: (key: string) => Promise.resolve(data.get(key)),
          set: (key: string, value: unknown) => {
            data.set(key, value)
            return Promise.resolve()
          },
          delete: (key: string) => {
            data.delete(key)
            return Promise.resolve()
          },
          keys: () => Promise.resolve([...data.keys()]),
        },
      },
    })

    await mount(view())
    await flush()
    await click(button('display-settings'))
    await click(button('display-updated'))
    await click(button('display-assignees'))
    await flush()

    await teardownDom()
    setupDom()
    await mount(view())
    await flush()

    await click(button('display-settings'))
    expect(button('display-updated').getAttribute('aria-pressed')).toBe('true')
    expect(button('display-assignees').getAttribute('aria-pressed')).toBe('true')
    expect(mustFind('ticket-age').textContent).toContain('更新')
  })
})
