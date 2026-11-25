import { describe, expect, it } from 'vitest'

import type { TicketSnapshot, TicketStatus } from '../protocol/tracker.ts'
import { countByFilter, countTickets, filterTickets, viewTickets, type PeopleFilter } from './ticket-view.ts'

const NONE: PeopleFilter = { assignedToMe: false, createdByMe: false }
const ASSIGNED: PeopleFilter = { assignedToMe: true, createdByMe: false }
const CREATED: PeopleFilter = { assignedToMe: false, createdByMe: true }
const BOTH: PeopleFilter = { assignedToMe: true, createdByMe: true }

function ticket(
  number: number,
  options: {
    readonly status?: TicketStatus
    readonly author?: string | null
    readonly assignees?: readonly string[]
  } = {},
): TicketSnapshot {
  const status = options.status ?? 'open'
  const authorLogin = options.author === undefined ? `user${String(number)}` : options.author
  return {
    ref: `#${String(number)}`,
    number,
    title: `票 ${String(number)}`,
    state: status === 'closed' ? 'closed' : 'open',
    category: null,
    status,
    labels: [],
    author:
      authorLogin === null
        ? null
        : { login: authorLogin, displayName: null, avatarUrl: null },
    assignees: options.assignees ?? [],
    skillAction: 'none',
    skillActionReason: 'untriaged',
    createdAt: `2026-11-${String(number).padStart(2, '0')}T00:00:00Z`,
    updatedAt: `2026-11-${String(number).padStart(2, '0')}T12:00:00Z`,
    openBlockers: status === 'blocked' ? 1 : 0,
  }
}

const TICKETS: readonly TicketSnapshot[] = [
  ticket(1, { status: 'ready', assignees: ['Me'] }),
  ticket(2, { status: 'ready', author: 'me' }),
  ticket(3, { status: 'ready', assignees: ['alice'], author: 'alice' }),
  ticket(4, { status: 'blocked', assignees: ['me'] }),
  ticket(5, { status: 'open', author: 'me' }),
  ticket(6, { status: 'closed', assignees: ['me'] }),
  ticket(7, { status: 'closed', author: 'me' }),
  ticket(8, { status: 'open', author: null }),
]

function refs(tickets: readonly TicketSnapshot[]): string[] {
  return tickets.map((item) => item.ref)
}

function query(
  filter: 'all' | 'open' | 'closed' | 'blocked' | 'ready',
  people: PeopleFilter,
  viewer: string | null = 'me',
) {
  return { filter, sortKey: 'number' as const, direction: 'asc' as const, viewer, people }
}

describe('人员筛选', () => {
  it('两个开关都关时不按人员过滤', () => {
    const view = viewTickets(TICKETS, query('all', NONE))

    expect(refs(view.visible)).toEqual(['#1', '#2', '#3', '#4', '#5', '#6', '#7', '#8'])
  })

  it('只开「分配给我」时只看对应角色', () => {
    const view = viewTickets(TICKETS, query('all', ASSIGNED))

    expect(refs(view.visible)).toEqual(['#1', '#4', '#6'])
  })

  it('只开「我创建的」时只看对应角色', () => {
    const view = viewTickets(TICKETS, query('all', CREATED))

    expect(refs(view.visible)).toEqual(['#2', '#5', '#7'])
  })

  it('两个都开时取并集，不是交集', () => {
    const view = viewTickets(TICKETS, query('all', BOTH))

    expect(refs(view.visible)).toEqual(['#1', '#2', '#4', '#5', '#6', '#7'])
  })

  it('与每个状态筛选交叉生效', () => {
    expect(refs(viewTickets(TICKETS, query('ready', ASSIGNED)).visible)).toEqual(['#1'])
    expect(refs(viewTickets(TICKETS, query('closed', CREATED)).visible)).toEqual(['#7'])
    expect(refs(viewTickets(TICKETS, query('blocked', BOTH)).visible)).toEqual(['#4'])
    expect(refs(viewTickets(TICKETS, query('open', ASSIGNED)).visible)).toEqual(['#1', '#4'])
  })

  it('登录名比较不区分大小写', () => {
    const view = viewTickets(TICKETS, query('all', ASSIGNED, 'ME'))

    expect(refs(view.visible)).toEqual(['#1', '#4', '#6'])
  })

  it('创建人为 null 时不算「我创建的」', () => {
    const view = viewTickets(TICKETS, query('open', CREATED, 'me'))

    expect(refs(view.visible)).not.toContain('#8')
  })

  it('分配人为空时不算「分配给我」', () => {
    const view = viewTickets(TICKETS, query('all', ASSIGNED))

    expect(refs(view.visible)).not.toContain('#2')
  })

  it('当前用户为 null 时忽略人员开关', () => {
    const view = viewTickets(TICKETS, query('all', BOTH, null))

    expect(refs(view.visible)).toEqual(['#1', '#2', '#3', '#4', '#5', '#6', '#7', '#8'])
    expect(view.counts).toEqual({ assignedToMe: 0, createdByMe: 0 })
  })

  it('筛选后仍按排序键排序', () => {
    const view = viewTickets(TICKETS, {
      filter: 'all',
      sortKey: 'number',
      direction: 'desc',
      viewer: 'me',
      people: BOTH,
    })

    expect(refs(view.visible)).toEqual(['#7', '#6', '#5', '#4', '#2', '#1'])
  })
})

describe('人员计数', () => {
  it('按当前状态筛选后的集合统计', () => {
    const view = viewTickets(TICKETS, query('ready', NONE))

    expect(view.counts).toEqual({ assignedToMe: 1, createdByMe: 1 })
  })

  it('两个角色的计数互不影响', () => {
    const view = viewTickets(TICKETS, query('all', ASSIGNED))

    expect(view.counts).toEqual({ assignedToMe: 3, createdByMe: 3 })
  })

  it('同一张票既是分配给我又是我创建的时两个计数各算一次', () => {
    const view = viewTickets([ticket(9, { assignees: ['me'], author: 'me' })], query('all', NONE))

    expect(view.counts).toEqual({ assignedToMe: 1, createdByMe: 1 })
  })
})

describe('筛选计数', () => {
  it('每个筛选段的计数等于点开后的行数', () => {
    const counts = countByFilter(countTickets(TICKETS))

    for (const filter of ['all', 'open', 'closed', 'blocked', 'ready'] as const) {
      expect(counts[filter]).toBe(filterTickets(TICKETS, filter).length)
    }
  })

  it('Open 统计所有未关闭票，不只算「其他开放」', () => {
    expect(countByFilter(countTickets(TICKETS))).toEqual({
      all: 8,
      open: 6,
      closed: 2,
      blocked: 1,
      ready: 3,
    })
  })
})
