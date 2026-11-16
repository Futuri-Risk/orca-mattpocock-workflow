import { describe, expect, it } from 'vitest'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import {
  ancestorRefs,
  buildTicketRows,
  expandAncestors,
  type TicketTreeRow,
} from './ticket-tree.ts'

function ticket(ref: string, parent?: string): TicketSnapshot {
  const number = ref.startsWith('#') ? Number.parseInt(ref.slice(1), 10) : null
  return {
    ref,
    number: Number.isInteger(number) ? number : null,
    title: `票 ${ref}`,
    state: 'open',
    category: null,
    status: 'ready',
    labels: [],
    author: null,
    assignees: [],
    skillAction: 'implement',
    skillActionReason: 'ready-for-agent',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    openBlockers: 0,
    ...(parent === undefined ? {} : { parent }),
  }
}

function order(rows: readonly TicketTreeRow[]): string[] {
  return rows.map((row) => row.ticket.ref)
}

describe('工单树构建', () => {
  it('平铺模式每张票一行，没有层级装饰', () => {
    const rows = buildTicketRows([ticket('#3'), ticket('#2', '#1'), ticket('#1')], 'flat', new Set())

    expect(order(rows)).toEqual(['#3', '#2', '#1'])
    for (const row of rows) {
      expect(row.depth).toBe(0)
      expect(row.hasChildren).toBe(false)
      expect(row.expanded).toBe(true)
      expect(row.parentOutsideView).toBe(false)
      expect(row.descendantCount).toBe(0)
    }
  })

  it('单层父子：顶层按输入顺序，子票聚在父票下', () => {
    const rows = buildTicketRows(
      [ticket('#1'), ticket('#2'), ticket('#3', '#1'), ticket('#4', '#2'), ticket('#5', '#1')],
      'hierarchy',
      new Set(),
    )

    expect(order(rows)).toEqual(['#1', '#3', '#5', '#2', '#4'])
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 1, 0, 1])
    expect(rows[0]?.hasChildren).toBe(true)
    expect(rows[0]?.descendantCount).toBe(2)
    expect(rows[3]?.hasChildren).toBe(true)
    expect(rows[1]?.hasChildren).toBe(false)
  })

  it('多级父子逐层缩进', () => {
    const rows = buildTicketRows(
      [ticket('#1'), ticket('#2', '#1'), ticket('#3', '#2'), ticket('#4', '#3')],
      'hierarchy',
      new Set(),
    )

    expect(order(rows)).toEqual(['#1', '#2', '#3', '#4'])
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 3])
    expect(rows[0]?.descendantCount).toBe(3)
    expect(rows[1]?.descendantCount).toBe(2)
  })

  it('父级不在可见票里时升到顶层并标记父级在列表外', () => {
    const rows = buildTicketRows(
      [ticket('#5', '#99'), ticket('#6', 'owner/other#42'), ticket('#7', '&3')],
      'hierarchy',
      new Set(),
    )

    expect(order(rows)).toEqual(['#5', '#6', '#7'])
    expect(rows.every((row) => row.depth === 0)).toBe(true)
    expect(rows.every((row) => row.parentOutsideView)).toBe(true)
  })

  it('自引用按顶层处理，不伪造父级提示', () => {
    const rows = buildTicketRows([ticket('#1', '#1'), ticket('#2')], 'hierarchy', new Set())

    expect(order(rows)).toEqual(['#1', '#2'])
    expect(rows[0]?.depth).toBe(0)
    expect(rows[0]?.parentOutsideView).toBe(false)
  })

  it('两票成环时都提升为顶层，不递归丢票', () => {
    const rows = buildTicketRows(
      [ticket('#1', '#2'), ticket('#2', '#1'), ticket('#3')],
      'hierarchy',
      new Set(),
    )

    expect(order(rows)).toEqual(['#1', '#2', '#3'])
    expect(rows.every((row) => row.depth === 0)).toBe(true)
  })

  it('多票成环只提升环上的票，环外的子票仍挂在父票下', () => {
    const rows = buildTicketRows(
      [ticket('#A', '#B'), ticket('#B', '#C'), ticket('#C', '#B'), ticket('#D', '#A')],
      'hierarchy',
      new Set(),
    )

    expect(order(rows)).toEqual(['#B', '#A', '#D', '#C'])
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 0])
    expect(rows[0]?.descendantCount).toBe(2)
  })

  it('折叠父票后整棵子树隐藏，再展开恢复原来的排序', () => {
    const tickets = [
      ticket('#1'),
      ticket('#2', '#1'),
      ticket('#3', '#2'),
      ticket('#4'),
    ]

    const collapsed = new Set(['#1'])
    const hidden = buildTicketRows(tickets, 'hierarchy', collapsed)
    expect(order(hidden)).toEqual(['#1', '#4'])
    expect(hidden[0]?.expanded).toBe(false)
    expect(hidden[0]?.descendantCount).toBe(2)

    // 折叠只影响渲染：折叠集合清掉后，子票按原输入顺序回来。
    const shown = buildTicketRows(tickets, 'hierarchy', new Set())
    expect(order(shown)).toEqual(['#1', '#2', '#3', '#4'])
  })

  it('嵌套折叠各自保留：展开父票时子票仍折叠', () => {
    const tickets = [ticket('#1'), ticket('#2', '#1'), ticket('#3', '#2')]
    const collapsed = new Set(['#2'])

    const rows = buildTicketRows(tickets, 'hierarchy', collapsed)

    expect(order(rows)).toEqual(['#1', '#2'])
    expect(rows[1]?.expanded).toBe(false)
  })

  it('空输入返回空行', () => {
    expect(buildTicketRows([], 'hierarchy', new Set())).toEqual([])
    expect(buildTicketRows([], 'flat', new Set())).toEqual([])
  })
})

describe('定位票的祖先展开', () => {
  const tickets = [ticket('#1'), ticket('#2', '#1'), ticket('#3', '#2'), ticket('#4')]

  it('按从直接父级到根的顺序给出祖先链', () => {
    expect(ancestorRefs(tickets, '#3')).toEqual(['#2', '#1'])
    expect(ancestorRefs(tickets, '#1')).toEqual([])
    expect(ancestorRefs(tickets, '#99')).toEqual([])
    expect(ancestorRefs(tickets, null)).toEqual([])
  })

  it('把祖先从折叠集合里移除，其他折叠保留', () => {
    const collapsed = new Set(['#1', '#2', '#4'])
    const next = expandAncestors(tickets, collapsed, '#3')

    expect([...next].sort()).toEqual(['#4'])
    // 原始集合不被改写。
    expect([...collapsed].sort()).toEqual(['#1', '#2', '#4'])
  })

  it('没有需要展开的祖先时原样返回同一个集合', () => {
    const collapsed = new Set(['#2'])
    expect(expandAncestors(tickets, collapsed, '#1')).toBe(collapsed)
  })

  it('祖先链遇环时停止，不无限展开', () => {
    const cyclic = [ticket('#1', '#2'), ticket('#2', '#1')]

    expect(ancestorRefs(cyclic, '#1')).toEqual(['#2'])
    // 只展开祖先；目标票自己的折叠状态保留。
    expect([...expandAncestors(cyclic, new Set(['#1', '#2']), '#1')]).toEqual(['#1'])
  })
})
