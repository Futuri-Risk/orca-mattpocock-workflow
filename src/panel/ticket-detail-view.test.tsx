// @vitest-environment happy-dom
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MESSAGES } from '../protocol/i18n.ts'
import type { RpcResult, TicketDetail } from '../protocol/tracker.ts'
import {
  button,
  click,
  find,
  mustFind,
  render,
  settleWith,
  setupDom,
  teardownDom,
} from './dom-test-support.ts'
import type { PromptCopy } from './injection.ts'
import { TicketDetailView, type TicketDetailViewProps } from './ticket-detail-view.tsx'
import {
  deferred,
  fail,
  makeDetail,
  makeSnapshot,
  makeTicket,
  ok,
} from './ticket-detail-test-support.ts'
import type { PanelClient } from './transport.ts'

const ZH = MESSAGES['zh-CN']
const NOT_FOUND = { code: 'ticket-not-found', message: '没有这张票' } as const
const COPY: PromptCopy = {
  canCopy: true,
  copy: async () => ({ outcome: 'copied', reason: null }),
}

interface DetailClientOptions {
  readonly getDetail?: PanelClient['getDetail']
  readonly refresh?: PanelClient['refresh']
  readonly getOptions?: PanelClient['getOptions']
  readonly updateTicket?: PanelClient['updateTicket']
  readonly deleteTicket?: PanelClient['deleteTicket']
}

/** 只实现详情视图会走到的入口；其余方法不会被调用。 */
function clientWith(options: DetailClientOptions = {}): PanelClient {
  return {
    getDetail: options.getDetail ?? (async () => ok(makeDetail())),
    refresh: options.refresh ?? (async () => ok(makeSnapshot())),
    getOptions: options.getOptions ?? (async () => ok({ labels: [], assignees: [] })),
    updateTicket: options.updateTicket ?? (async () => ok({ applied: true })),
    deleteTicket: options.deleteTicket ?? (async () => ok({ deleted: true })),
  } as unknown as PanelClient
}

function view(
  client: PanelClient,
  overrides: Partial<TicketDetailViewProps> = {},
): ReactElement {
  return (
    <TicketDetailView
      client={client}
      workspaceRoot="/ws"
      ticket={makeTicket()}
      copy={COPY}
      onBack={() => undefined}
      onOpenEnvCheck={() => undefined}
      {...overrides}
    />
  )
}

beforeEach(() => {
  setupDom()
})

afterEach(async () => {
  await teardownDom()
})

describe('工单详情刷新按钮', () => {
  it('详情加载完成后出现刷新按钮，名称与悬停说明是「刷新工单」', async () => {
    await render(view(clientWith()))

    const refresh = button('detail-refresh')
    expect(refresh.getAttribute('aria-label')).toBe(ZH['detail.refresh'])
    expect(refresh.getAttribute('title')).toBe(ZH['detail.refresh'])
    expect(refresh.disabled).toBe(false)
    expect(find('detail-retry')).toBeNull()
    expect(mustFind('detail-title').textContent).toBe('Ticket 18')
  })

  it('刷新按钮紧跟在关闭/重开之后、复制链接之前', async () => {
    const getDetail = vi.fn<PanelClient['getDetail']>(async () =>
      ok(
        makeDetail({
          url: 'https://example.com/issues/18',
          capabilities: { labels: false, assignees: false, state: true, link: true, delete: false },
        }),
      ),
    )
    await render(view(clientWith({ getDetail })))

    const state = button('detail-state-toggle')
    const refresh = button('detail-refresh')
    const copy = button('detail-copy')
    const following = Node.DOCUMENT_POSITION_FOLLOWING
    expect(state.compareDocumentPosition(refresh) & following).not.toBe(0)
    expect(refresh.compareDocumentPosition(copy) & following).not.toBe(0)
  })

  it('首次加载失败时只有「重试」，没有刷新按钮', async () => {
    await render(view(clientWith({ getDetail: async () => fail(NOT_FOUND) })))

    expect(button('detail-retry')).not.toBeNull()
    expect(find('detail-refresh')).toBeNull()
  })

  it('刷新期间保留旧内容、不出现加载占位，按钮禁用并改名', async () => {
    const next = deferred<RpcResult<TicketDetail>>()
    const getDetail = vi
      .fn<PanelClient['getDetail']>()
      .mockResolvedValueOnce(ok(makeDetail({ title: '旧标题' })))
      .mockReturnValueOnce(next.promise)
    await render(view(clientWith({ getDetail })))

    const refresh = button('detail-refresh')
    // 两次点击在同一轮 act 里发出：第二次发生时按钮还没重渲染成 disabled，
    // 只有 ref 栏杆能拦住它。
    await settleWith(() => {
      refresh.click()
      refresh.click()
    })

    expect(getDetail).toHaveBeenCalledTimes(2)
    expect(find('detail-loading')).toBeNull()
    expect(mustFind('detail-title').textContent).toBe('旧标题')
    expect(refresh.disabled).toBe(true)
    expect(refresh.getAttribute('aria-label')).toBe(ZH['detail.refreshing'])

    await settleWith(() => {
      next.resolve(ok(makeDetail({ title: '新标题' })))
    })
    expect(mustFind('detail-title').textContent).toBe('新标题')
    expect(refresh.disabled).toBe(false)
    expect(refresh.getAttribute('aria-label')).toBe(ZH['detail.refresh'])
  })

  it('刷新失败保留旧内容并说明原因，重试成功后错误消失、内容更新', async () => {
    const getDetail = vi
      .fn<PanelClient['getDetail']>()
      .mockResolvedValueOnce(ok(makeDetail({ title: '旧标题' })))
      .mockResolvedValueOnce(fail(NOT_FOUND))
      .mockResolvedValueOnce(ok(makeDetail({ title: '新标题' })))
    await render(view(clientWith({ getDetail })))

    await click(button('detail-refresh'))

    const alert = mustFind('detail-refresh-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain(
      ZH['detail.refreshFailed'].replace('{detail}', ZH['error.ticket-not-found']),
    )
    expect(mustFind('detail-title').textContent).toBe('旧标题')
    expect(button('detail-refresh').disabled).toBe(false)

    await click(button('detail-refresh'))

    expect(find('detail-refresh-error')).toBeNull()
    expect(mustFind('detail-title').textContent).toBe('新标题')
  })

  it('刷新进行中禁用关闭/重开与标签、分配人控件', async () => {
    const pending = deferred<RpcResult<TicketDetail>>()
    const getDetail = vi
      .fn<PanelClient['getDetail']>()
      .mockResolvedValueOnce(
        ok(
          makeDetail({
            capabilities: { labels: true, assignees: true, state: true, link: false, delete: false },
          }),
        ),
      )
      .mockReturnValueOnce(pending.promise)
    await render(view(clientWith({ getDetail })))

    expect(button('detail-state-toggle').disabled).toBe(false)
    await click(button('detail-refresh'))

    expect(button('detail-state-toggle').disabled).toBe(true)
    expect(button('label-edit').disabled).toBe(true)
    expect(button('assignee-edit').disabled).toBe(true)
  })

  it('写操作进行中刷新按钮不可用', async () => {
    const update = deferred<RpcResult<{ readonly applied: true }>>()
    const getDetail = vi.fn<PanelClient['getDetail']>(async () =>
      ok(
        makeDetail({
          capabilities: { labels: false, assignees: false, state: true, link: false, delete: false },
        }),
      ),
    )
    await render(view(clientWith({ getDetail, updateTicket: () => update.promise })))

    await click(button('detail-state-toggle'))

    expect(button('detail-refresh').disabled).toBe(true)

    await settleWith(() => {
      update.resolve(ok({ applied: true }))
    })
  })

  it('删除确认面板打开时刷新按钮不可用', async () => {
    const getDetail = vi.fn<PanelClient['getDetail']>(async () =>
      ok(
        makeDetail({
          capabilities: { labels: false, assignees: false, state: false, link: false, delete: true },
        }),
      ),
    )
    await render(view(clientWith({ getDetail })))

    await click(button('detail-more'))
    await click(button('detail-delete'))

    expect(find('delete-confirm')).not.toBeNull()
    expect(button('detail-refresh').disabled).toBe(true)
  })

  it('刷新不会返回列表，也不会复制提示词', async () => {
    const onBack = vi.fn()
    const copy = vi.fn(async () => ({ outcome: 'copied' as const, reason: null }))
    const getDetail = vi
      .fn<PanelClient['getDetail']>()
      .mockResolvedValueOnce(ok(makeDetail()))
      .mockResolvedValueOnce(ok(makeDetail({ title: '新标题' })))
    await render(
      view(clientWith({ getDetail }), {
        copy: { canCopy: true, copy },
        onBack,
      }),
    )

    await click(button('detail-refresh'))

    expect(onBack).not.toHaveBeenCalled()
    expect(copy).not.toHaveBeenCalled()
    expect(find('ticket-detail')).not.toBeNull()
  })

  it('切到另一张票后，旧的刷新结果不会落地，按钮也不会卡在刷新中', async () => {
    const stale = deferred<RpcResult<TicketDetail>>()
    const getDetail = vi
      .fn<PanelClient['getDetail']>()
      .mockResolvedValueOnce(ok(makeDetail({ ref: '#18', number: 18, title: '旧票' })))
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(ok(makeDetail({ ref: '#19', number: 19, title: '新票' })))
    const client = clientWith({ getDetail })
    await render(view(client, { ticket: makeTicket({ ref: '#18', number: 18, title: '旧票' }) }))

    await click(button('detail-refresh'))
    await render(view(client, { ticket: makeTicket({ ref: '#19', number: 19, title: '新票' }) }))
    expect(mustFind('detail-title').textContent).toBe('新票')

    await settleWith(() => {
      stale.resolve(ok(makeDetail({ ref: '#18', number: 18, title: '过期结果' })))
    })

    expect(mustFind('detail-title').textContent).toBe('新票')
    expect(document.body.textContent).not.toContain('过期结果')
    expect(button('detail-refresh').disabled).toBe(false)
  })
})
