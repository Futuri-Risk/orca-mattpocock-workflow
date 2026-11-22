import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it } from 'vitest'

import { MESSAGES } from '../protocol/i18n.ts'
import type { TicketAuthor, TicketSnapshot } from '../protocol/tracker.ts'
import { TicketList } from './ticket-list.tsx'
import { buildTicketRows, type TicketLayout } from './ticket-tree.ts'
import { createPanelClient } from './transport.ts'
import { DEFAULT_ROW_FIELDS, type RowFields } from './view-preference.ts'

const ZH = MESSAGES['zh-CN']
const NOW = Date.parse('2026-06-01T00:00:00Z')

/** 有展示名、没有头像的创建人：行内显示名字与首字母色块。 */
const ALICE: TicketAuthor = { login: 'alice', displayName: 'Alice', avatarUrl: null }

function ticket(
  ref: string,
  parent?: string,
  overrides: Partial<TicketSnapshot> = {},
): TicketSnapshot {
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
    ...overrides,
  }
}

/** 带远端链接的票：编号在列表里变成复制按钮。 */
function linkedTicket(ref: string, url: string): TicketSnapshot {
  return { ...ticket(ref), url }
}

function render(
  tickets: readonly TicketSnapshot[],
  layout: TicketLayout,
  collapsed: ReadonlySet<string> = new Set(),
  backend: 'github' | 'gitea' = 'github',
  fields: Partial<RowFields> = {},
): string {
  const rows = buildTicketRows(tickets, layout, collapsed)
  return renderToStaticMarkup(
    <TicketList
      rows={rows}
      layout={layout}
      emptyText={ZH['tickets.emptyRepo']}
      copied={null}
      now={NOW}
      backend={backend}
      workspaceRoot="/workspace"
      rowFields={{ ...DEFAULT_ROW_FIELDS, ...fields }}
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

/** 取某个 testid 的 span 内文；这些元素内部没有嵌套 span。 */
function textOf(markup: string, testId: string): string {
  const pattern = new RegExp(`data-testid="${testId}"[^>]*>(.*?)</span>`, 'su')
  return markup.match(pattern)?.[1] ?? ''
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

  it('有父票时只有子级叶子行保留占位，顶层叶子不空出一块被误认成子级', () => {
    const markup = render(
      [ticket('#1'), ticket('#2', '#1'), ticket('#3', '#1'), ticket('#4')],
      'hierarchy',
    )

    expect(count(markup, 'data-testid="ticket-collapse"')).toBe(1)
    // #2、#3 是子级叶子：留占位与同层父票的标题对齐；顶层叶子 #4 不留。
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

  it('有链接时编号是独立按钮，标题里不再含编号徽标', () => {
    const url = 'https://github.com/o/r/issues/1'

    for (const layout of ['flat', 'hierarchy'] as const) {
      const markup = render([linkedTicket('#1', url)], layout)

      expect(markup).toMatch(/<button[^>]*data-testid="ticket-ref"[^>]*data-ref="#1"/)
      expect(markup).toContain('data-hover="ref"')
      expect(markup).toContain(`aria-label="${ZH['tickets.refCopyLabel'].replace('{ref}', '#1')}"`)
      expect(markup).toContain(`title="${ZH['tickets.refCopyHint'].replace('{url}', url)}"`)

      // 标题是行内文本块而不是按钮：折行要回到编号左缘，按钮会自成一行把文字顶下去。
      const titleText = markup.match(
        /<span[^>]*data-testid="ticket-row"[^>]*>(.*?)<\/span>/su,
      )
      expect(titleText?.[1] ?? '').not.toContain('ticket-ref')
      expect(titleText?.[1] ?? '').toContain('票 #1')
      expect(markup).not.toMatch(/<button[^>]*data-testid="ticket-row"/)
    }
  })

  it('没有链接时编号退回普通文字，不是按钮', () => {
    const markup = render([ticket('#1')], 'flat')

    expect(markup).toContain('<span data-testid="ticket-ref"')
    expect(markup).not.toMatch(/<button[^>]*data-testid="ticket-ref"/)
  })
})

describe('行内显示字段', () => {
  it('默认显示创建人与裸创建时间，不显示更新时间与分配人', () => {
    const markup = render([
      ticket('#1', undefined, { author: ALICE, assignees: ['alice'] }),
    ], 'flat')

    expect(markup).toContain('data-testid="ticket-author"')
    expect(markup).toContain('Alice')
    expect(textOf(markup, 'ticket-age')).toBe('31 天前')
    expect(textOf(markup, 'ticket-age')).not.toContain('更新')
    expect(markup).not.toContain('ticket-assignees')
  })

  it('打开更新时间时显示创建与更新两段，悬停给出绝对时刻', () => {
    const markup = render([ticket('#1', undefined, { author: ALICE })], 'flat', new Set(), 'github', {
      showUpdatedAt: true,
    })

    expect(textOf(markup, 'ticket-age')).toBe('创建 31 天前 · 更新 30 天前')
    expect(markup).toContain(
      `title="${ZH['tickets.ageTitle']
        .replace('{created}', '2026-05-01T00:00:00Z')
        .replace('{updated}', '2026-05-02T00:00:00Z')}"`,
    )
  })

  it('关闭创建人时时间仍在，并加「创建」前缀', () => {
    const markup = render([ticket('#1', undefined, { author: ALICE })], 'flat', new Set(), 'github', {
      showAuthor: false,
    })

    expect(markup).not.toContain('ticket-author')
    expect(markup).not.toContain('ticket-avatar')
    expect(textOf(markup, 'ticket-age')).toBe('创建 31 天前')
  })

  it('没有创建人的行默认显示创建时间', () => {
    const markup = render([ticket('#1')], 'flat')

    expect(markup).not.toContain('ticket-author')
    expect(textOf(markup, 'ticket-age')).toBe('创建 31 天前')
  })

  it('关闭创建时间后时间区消失，创建人仍在', () => {
    const markup = render([ticket('#1', undefined, { author: ALICE })], 'flat', new Set(), 'github', {
      showCreatedAt: false,
    })

    expect(markup).toContain('ticket-author')
    expect(markup).not.toContain('ticket-age')
  })

  it('打开分配人时显示裸登录名，不加 @', () => {
    const markup = render(
      [ticket('#1', undefined, { assignees: ['alice', 'bob'] })],
      'flat',
      new Set(),
      'github',
      { showAssignees: true },
    )

    expect(markup).toContain('data-testid="ticket-assignees"')
    expect(textOf(markup, 'ticket-assignee')).toBe('alice, bob')
    expect(markup).not.toContain('@alice')
    expect(markup).toContain(
      `aria-label="${ZH['tickets.row.assigneesLabel'].replace('{names}', 'alice, bob')}"`,
    )
  })

  it('分配人为空数组时不渲染图标或占位', () => {
    const markup = render([ticket('#1')], 'flat', new Set(), 'github', { showAssignees: true })

    expect(markup).not.toContain('ticket-assignees')
  })

  it('分配人超过两个时只显示前两个并追加 +N，悬停说明列出全部', () => {
    const markup = render(
      [ticket('#1', undefined, { assignees: ['alice', 'bob', 'carol'] })],
      'flat',
      new Set(),
      'github',
      { showAssignees: true },
    )

    expect(textOf(markup, 'ticket-assignee')).toBe('alice, bob')
    expect(textOf(markup, 'ticket-assignee-more')).toBe('+1')
    expect(markup).toContain(
      `title="${ZH['tickets.row.assigneesMoreTitle']
        .replace('{count}', '1')
        .replace('{names}', 'alice, bob, carol')}"`,
    )
  })

  it('更新时间无法解析时省略更新段，创建时间照常显示', () => {
    const markup = render(
      [ticket('#1', undefined, { author: ALICE, updatedAt: 'not-a-time' })],
      'flat',
      new Set(),
      'github',
      { showUpdatedAt: true },
    )

    expect(textOf(markup, 'ticket-age')).toBe('创建 31 天前')
    expect(textOf(markup, 'ticket-age')).not.toContain('更新')
  })

  it('两段时间都无法解析且没有创建人时整个时间区不渲染', () => {
    const markup = render(
      [ticket('#1', undefined, { createdAt: 'not-a-time', updatedAt: 'also-bad' })],
      'flat',
      new Set(),
      'github',
      { showUpdatedAt: true },
    )

    expect(markup).not.toContain('ticket-age')
  })

  it('分配人排在创建人与时间之前', () => {
    const markup = render(
      [ticket('#1', undefined, { author: ALICE, assignees: ['alice'] })],
      'flat',
      new Set(),
      'github',
      { showAssignees: true },
    )

    const assignees = markup.indexOf('data-testid="ticket-assignees"')
    const author = markup.indexOf('data-testid="ticket-author"')
    const age = markup.indexOf('data-testid="ticket-age"')
    expect(assignees).toBeGreaterThanOrEqual(0)
    expect(assignees).toBeLessThan(author)
    expect(author).toBeLessThan(age)
  })
})

describe('Gitea 正文约定的父子布局', () => {
  /** `to-tickets` 在 Gitea 上发布的一组票：来源 spec 与它的直接子票。 */
  const SPEC_TICKETS = [
    ticket('#15'),
    ticket('#16', '#15'),
    ticket('#17', '#15'),
    ticket('#9'),
  ]

  it('来源 spec 下的子票缩进，父行显示可见子票数', () => {
    const markup = render(SPEC_TICKETS, 'hierarchy', new Set(), 'gitea')

    expect(rowsOf(markup)).toEqual([
      { ref: '#15', depth: '0', outside: false },
      { ref: '#16', depth: '1', outside: false },
      { ref: '#17', depth: '1', outside: false },
      { ref: '#9', depth: '0', outside: false },
    ])
    expect(markup).toContain(ZH['tickets.childCount'].replace('{count}', '2'))
    expect(count(markup, 'data-testid="ticket-parent"')).toBe(0)
  })

  it('来源 spec 被筛掉或还没加载时，子票升到顶层并显示父级徽标', () => {
    const markup = render(
      SPEC_TICKETS.filter((item) => item.ref !== '#15'),
      'hierarchy',
      new Set(),
      'gitea',
    )

    expect(rowsOf(markup)).toEqual([
      { ref: '#16', depth: '0', outside: true },
      { ref: '#17', depth: '0', outside: true },
      { ref: '#9', depth: '0', outside: false },
    ])
    expect(count(markup, 'data-testid="ticket-parent"')).toBe(2)
    expect(markup).toContain(ZH['tickets.parentOutside'].replace('{parent}', '#15'))
  })
})
