import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it } from 'vitest'

import { MESSAGES } from '../protocol/i18n.ts'
import { PeopleFilterRow } from './tickets-view.tsx'

const ZH = MESSAGES['zh-CN']

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
