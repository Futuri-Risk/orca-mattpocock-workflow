import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it } from 'vitest'

import { MESSAGES } from '../protocol/i18n.ts'
import { hierarchyAvailability } from './hierarchy-text.ts'
import { createTranslator } from './i18n.ts'
import { LayoutToggle } from './layout-toggle.tsx'

const T = createTranslator('zh-CN')
const ZH = MESSAGES['zh-CN']

function render(backend: 'github' | 'gitlab' | 'gitea', hierarchy: 'native' | 'convention' | 'none'): string {
  return renderToStaticMarkup(
    <LayoutToggle
      layout="hierarchy"
      hierarchy={hierarchyAvailability(backend, hierarchy, T)}
      onLayout={() => undefined}
    />,
  )
}

function count(markup: string, needle: string): number {
  return markup.split(needle).length - 1
}

describe('布局切换', () => {
  it('父子可用时显示来源说明，两个按钮都可操作', () => {
    const markup = render('github', 'native')

    expect(markup).toContain('aria-label="布局"')
    expect(markup).toContain(`data-testid="layout-flat" aria-pressed="false"`)
    expect(markup).toContain(`data-testid="layout-hierarchy" aria-pressed="true"`)
    expect(markup).not.toContain('aria-disabled="true"')
    expect(markup).toContain(`title="${ZH['tickets.layout.nativeHint']}"`)
    // 图标按钮没有可见文字；可访问名称必须带上动作与来源。
    expect(count(markup, '<svg')).toBe(2)
    expect(markup).toContain(`aria-label="${ZH['tickets.layout.flatHint']}"`)
    expect(markup).toContain(`aria-label="${ZH['tickets.layout.nativeHint']}"`)
  })

  it('Gitea 无父子能力时按钮标为不可用并说明原因', () => {
    const markup = render('gitea', 'none')

    expect(markup).toContain('aria-disabled="true"')
    expect(markup).toContain('data-disabled="true"')
    expect(markup).toContain(`title="${ZH['tickets.layout.unavailableGitea']}"`)
    // 读屏从可访问名称就能听到原因。
    expect(markup).toContain(`aria-label="${ZH['tickets.layout.unavailableGitea']}"`)
    // 偏好仍是父子：按钮保持选中，界面由降级提示说明已按平铺显示。
    expect(markup).toContain('aria-pressed="true"')
  })

  it('GitLab 层级取不到时说明下次刷新会重试', () => {
    const markup = render('gitlab', 'none')

    expect(markup).toContain('aria-disabled="true"')
    expect(markup).toContain(`title="${ZH['tickets.layout.unavailableGitlab']}"`)
  })
})
