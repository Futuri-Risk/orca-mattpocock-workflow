// @vitest-environment happy-dom
/**
 * 列表编号的复制入口。断言只落在外部行为上：点击编号后剪贴板里是什么、
 * 详情有没有被打开、链接缺失时编号是不是纯文本、剪贴板失败时用户还能不能拿到地址。
 *
 * 这些用例需要真实 DOM 事件与 React 状态更新，所以本文件跑 happy-dom；
 * 其余面板测试仍是静态标记渲染。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MESSAGES } from '../protocol/i18n.ts'
import type { TicketSnapshot } from '../protocol/tracker.ts'
import {
  click,
  mustFind,
  render,
  settle,
  settleWith,
  setupDom,
  teardownDom,
} from './dom-test-support.ts'
import { makeTicket } from './ticket-detail-test-support.ts'
import { TicketList } from './ticket-list.tsx'
import { buildTicketRows } from './ticket-tree.ts'
import { createPanelClient } from './transport.ts'
import { DEFAULT_ROW_FIELDS } from './view-preference.ts'

const ZH = MESSAGES['zh-CN']
const NOW = Date.parse('2026-06-01T00:00:00Z')
const ISSUE_URL = 'https://github.com/cnzgray/orca-mattpocock-workflow/issues/15'

function listTicket(): TicketSnapshot {
  return makeTicket({
    ref: '#15',
    number: 15,
    title: '点编号复制链接',
    url: ISSUE_URL,
  })
}

function list(
  tickets: readonly TicketSnapshot[],
  onPick: (ticket: TicketSnapshot) => void,
) {
  return (
    <TicketList
      rows={buildTicketRows(tickets, 'flat', new Set())}
      layout="flat"
      emptyText={ZH['tickets.emptyRepo']}
      copied={null}
      now={NOW}
      rowFields={DEFAULT_ROW_FIELDS}
      backend="github"
      workspaceRoot="/workspace"
      client={createPanelClient(() => Promise.reject(new Error('渲染时不应发请求')))}
      onOpenEnvCheck={() => undefined}
      onPick={onPick}
      onSkillAction={() => undefined}
      onToggleCollapse={() => undefined}
    />
  )
}

beforeEach(() => {
  setupDom()
})

afterEach(async () => {
  await teardownDom()
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'clipboard')
  Reflect.deleteProperty(document, 'execCommand')
})

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

/** 点击后多等两轮微任务，让复制 promise 链与随后的重渲染都落地。 */
async function clickAndSettle(element: HTMLElement): Promise<void> {
  await click(element)
  await settle()
  await settle()
}

describe('列表编号复制工单链接', () => {
  it('点击编号把链接写进剪贴板，不打开详情，并短暂显示已复制', async () => {
    const writeText = vi.fn(async () => undefined)
    stubClipboard(writeText)
    const onPick = vi.fn()
    await render(list([listTicket()], onPick))

    const ref = mustFind('ticket-ref')
    expect(ref.tagName).toBe('BUTTON')
    expect(ref.getAttribute('data-hover')).toBe('ref')
    expect(ref.getAttribute('aria-label')).toBe(
      ZH['tickets.refCopyLabel'].replace('{ref}', '#15'),
    )
    expect(ref.getAttribute('title')).toBe(ZH['tickets.refCopyHint'].replace('{url}', ISSUE_URL))
    // live region 在复制前就存在，复制后只改文本。
    expect(mustFind('ticket-ref-copied').textContent).toBe('')

    await clickAndSettle(ref)

    expect(writeText).toHaveBeenCalledWith(ISSUE_URL)
    expect(onPick).not.toHaveBeenCalled()
    expect(ref.textContent).toBe(ZH['common.copied'])
    expect(ref.getAttribute('data-hover')).toBeNull()
    expect(ref.getAttribute('aria-label')).toBe(
      ZH['tickets.refCopiedNotice'].replace('{ref}', '#15'),
    )
    expect(mustFind('ticket-ref-copied').textContent).toBe(
      ZH['tickets.refCopiedNotice'].replace('{ref}', '#15'),
    )
  })

  it('「已复制」两秒后自动复原', async () => {
    vi.useFakeTimers()
    stubClipboard(vi.fn(async () => undefined))
    await render(list([listTicket()], () => undefined))

    const ref = mustFind('ticket-ref')
    await clickAndSettle(ref)
    expect(ref.textContent).toBe(ZH['common.copied'])

    await settleWith(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(ref.textContent).toBe('#15')
    expect(ref.getAttribute('data-hover')).toBe('ref')
    expect(mustFind('ticket-ref-copied').textContent).toBe('')
  })

  it('点标题仍然打开详情', async () => {
    stubClipboard(vi.fn(async () => undefined))
    const onPick = vi.fn()
    const only = listTicket()
    await render(list([only], onPick))

    await click(mustFind('ticket-row'))

    expect(onPick).toHaveBeenCalledWith(only)
  })

  it('链接缺失时编号是普通文字，点击仍然打开详情', async () => {
    const onPick = vi.fn()
    const only = makeTicket({ ref: '#15', number: 15, title: '点编号复制链接' })
    await render(list([only], onPick))

    const ref = mustFind('ticket-ref')
    expect(ref.tagName).toBe('SPAN')

    await click(ref)

    expect(onPick).toHaveBeenCalledWith(only)
  })

  it('剪贴板不可用时说明原因，并把地址放进只读输入框', async () => {
    stubClipboard(async () => {
      throw new Error('denied')
    })
    // happy-dom 若实现 execCommand，这里显式移除以覆盖两级路径都失败的情形。
    Reflect.deleteProperty(document, 'execCommand')
    const onPick = vi.fn()
    await render(list([listTicket()], onPick))

    await clickAndSettle(mustFind('ticket-ref'))

    expect(mustFind('ticket-copy-error').textContent).toContain(
      ZH['copy.clipboardUnavailable'],
    )
    const field = mustFind('ticket-link') as HTMLInputElement
    expect(field.value).toBe(ISSUE_URL)
    expect(field.readOnly).toBe(true)
    expect(field.getAttribute('aria-label')).toBe(ZH['detail.linkLabel'])
    expect(onPick).not.toHaveBeenCalled()
  })
})

describe('读屏提示区不撑出滚动区', () => {
  const POSITIONED = new Set(['relative', 'absolute', 'fixed', 'sticky'])

  /** 绝对定位元素的包含块：最近一个非 static 定位的祖先；没有就落到页面上。 */
  function containingBlockOf(element: Element): Element | null {
    let ancestor = element.parentElement
    while (ancestor !== null) {
      if (POSITIONED.has(getComputedStyle(ancestor).position)) return ancestor
      ancestor = ancestor.parentElement
    }
    return null
  }

  it('复制结果的读屏区以列表滚动区为包含块，被它的溢出裁剪截住', async () => {
    // 包含块落到 body 时，最后一张卡片的读屏区会把整页撑高，面板多出第二条滚动条。
    await render(
      list(
        [listTicket(), makeTicket({ ref: '#16', number: 16, url: `${ISSUE_URL}6` })],
        () => undefined,
      ),
    )
    await settle()

    const scroller = mustFind('ticket-list')
    const notices = document.querySelectorAll('[data-testid="ticket-ref-copied"]')
    expect(notices.length).toBe(2)
    notices.forEach((notice) => {
      expect(getComputedStyle(notice).position).toBe('absolute')
      const block = containingBlockOf(notice)
      expect(block).not.toBeNull()
      expect(block === scroller || scroller.contains(block)).toBe(true)
    })
  })
})
