import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it } from 'vitest'

import { MESSAGES } from '../protocol/i18n.ts'
import type { TicketSnapshot } from '../protocol/tracker.ts'
import { TicketList } from './ticket-list.tsx'
import { buildTicketRows, type TicketLayout } from './ticket-tree.ts'
import { createPanelClient } from './transport.ts'

const ZH = MESSAGES['zh-CN']
const NOW = Date.parse('2026-06-01T00:00:00Z')

function ticket(ref: string, parent?: string): TicketSnapshot {
  return {
    ref,
    number: Number.parseInt(ref.replace(/^#/, ''), 10),
    title: `票 ${ref}`,
    state: 'open',
    category: null,
    status: 'ready',
    labels: [],
    author: null,
    assignees: [],
    skillAction: 'implement',
    skillActionReason: 'ready-for-agent',
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-02T00:00:00Z',
    openBlockers: 0,
    ...(parent === undefined ? {} : { parent }),
  }
}

function render(
  tickets: readonly TicketSnapshot[],
  layout: TicketLayout,
  collapsed: ReadonlySet<string> = new Set(),
): string {
  const rows = buildTicketRows(tickets, layout, collapsed)
  return renderToStaticMarkup(
    <TicketList
      rows={rows}
      layout={layout}
      emptyText={ZH['tickets.emptyRepo']}
      copied={null}
      now={NOW}
      backend="github"
      workspaceRoot="/workspace"
      client={createPanelClient(() => Promise.reject(new Error('渲染时不应发请求')))}
      onOpenEnvCheck={() => undefined}
      onPick={() => undefined}
      onSkillAction={() => undefined}
      onToggleCollapse={() => undefined}
    />,
  )
}

function count(markup: string, needle: string): number {
  return markup.split(needle).length - 1
}

/** 行按钮在文档里的顺序与层级标记。 */
function rowsOf(markup: string): readonly { ref: string; depth: string; outside: boolean }[] {
  const pattern = /data-testid="ticket-row-item" data-depth="(\d+)"(?: data-parent-outside="true")?/gu
  const depths = [...markup.matchAll(pattern)].map((match) => ({
    depth: match[1] ?? '0',
    outside: match[0].includes('data-parent-outside="true"'),
  }))
  const refs = [...markup.matchAll(/data-testid="ticket-row" data-ref="([^"]+)"/gu)].map(
    (match) => match[1] ?? '',
  )
  return refs.map((ref, index) => ({ ref, ...(depths[index] ?? { depth: '0', outside: false }) }))
}

describe('工单列表布局渲染', () => {
  it('平铺模式不显示折叠、子票数与父级徽标', () => {
    const markup = render([ticket('#1'), ticket('#2', '#1'), ticket('#3', '#9')], 'flat')

    expect(rowsOf(markup).map((row) => row.ref)).toEqual(['#1', '#2', '#3'])
    expect(count(markup, 'data-testid="ticket-collapse"')).toBe(0)
    expect(count(markup, 'data-testid="ticket-children"')).toBe(0)
    expect(count(markup, 'data-testid="ticket-parent"')).toBe(0)
    expect(count(markup, 'data-testid="skill-badge"')).toBe(3)
  })

  it('父子模式按树缩进，父行有折叠按钮与子票数', () => {
    const markup = render(
      [ticket('#1'), ticket('#2', '#1'), ticket('#3', '#2'), ticket('#4')],
      'hierarchy',
    )

    expect(rowsOf(markup)).toEqual([
      { ref: '#1', depth: '0', outside: false },
      { ref: '#2', depth: '1', outside: false },
      { ref: '#3', depth: '2', outside: false },
      { ref: '#4', depth: '0', outside: false },
    ])
    // #1 有两个后代、#3 是叶子：只有父票有折叠按钮。
    expect(count(markup, 'data-testid="ticket-collapse"')).toBe(2)
    expect(markup).toContain(
      `data-testid="ticket-collapse" data-ref="#1" data-expanded="true" aria-expanded="true"`,
    )
    expect(markup).toContain(`aria-label="${ZH['tickets.collapse']}"`)
    expect(markup).toContain(`${ZH['tickets.childCount'].replace('{count}', '2')}`)
    // 每张票的技能按钮照常渲染。
    expect(count(markup, 'data-testid="skill-badge"')).toBe(4)
  })

  it('父子模式下全是叶子时不留折叠槽位，卡片左侧不空出一块', () => {
    const markup = render([ticket('#11'), ticket('#14')], 'hierarchy')

    expect(count(markup, 'data-testid="ticket-collapse"')).toBe(0)
    expect(count(markup, 'data-testid="ticket-collapse-spacer"')).toBe(0)
  })

  it('有父票时叶子行保留占位，同层标题左缘对齐', () => {
    const markup = render([ticket('#1'), ticket('#2', '#1'), ticket('#4')], 'hierarchy')

    expect(count(markup, 'data-testid="ticket-collapse"')).toBe(1)
    expect(count(markup, 'data-testid="ticket-collapse-spacer"')).toBe(2)
  })

  it('折叠后子树隐藏，父行仍显示子票数并标记收起', () => {
    const markup = render(
      [ticket('#1'), ticket('#2', '#1'), ticket('#3', '#2'), ticket('#4')],
      'hierarchy',
      new Set(['#1']),
    )

    expect(rowsOf(markup).map((row) => row.ref)).toEqual(['#1', '#4'])
    expect(markup).toContain(
      `data-testid="ticket-collapse" data-ref="#1" data-expanded="false" aria-expanded="false"`,
    )
    expect(markup).toContain(`aria-label="${ZH['tickets.expand']}"`)
    expect(markup).toContain(`${ZH['tickets.childCount'].replace('{count}', '2')}`)
  })

  it('父级不在列表时升到顶层并显示完整引用的悬停说明', () => {
    const parent = 'owner/with-a-very-long-repository-name#12345'
    const markup = render([ticket('#5', parent), ticket('#6')], 'hierarchy')

    expect(rowsOf(markup)[0]).toEqual({ ref: '#5', depth: '0', outside: true })
    expect(count(markup, 'data-testid="ticket-parent"')).toBe(1)
    expect(markup).toContain(`title="${parent} · ${ZH['tickets.parentOutsideHint']}"`)
    // 徽标文字省略长引用，但保留可辨识的头尾。
    expect(markup).toContain('owner/with-a-very-lo')
    expect(markup).toContain(ZH['tickets.parentOutsideHint'])
  })

  it('空筛选沿用原有空状态，不渲染空树', () => {
    const markup = render([], 'hierarchy')

    expect(markup).toContain(`data-testid="empty"`)
    expect(markup).toContain(ZH['tickets.emptyRepo'])
    expect(count(markup, 'data-testid="ticket-row"')).toBe(0)
  })
})
