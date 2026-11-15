import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it } from 'vitest'

import { FLOW_COMMANDS, FLOW_DIAGRAMS, type FlowCommandId } from '../protocol/flow.ts'
import { HelpView } from './help-view.tsx'

function render(initialDiagramId?: string): string {
  const props =
    initialDiagramId === undefined
      ? { onBack: () => undefined }
      : { onBack: () => undefined, initialDiagramId }
  return renderToStaticMarkup(<HelpView {...props} />)
}

function count(markup: string, needle: string): number {
  return markup.split(needle).length - 1
}

function commandNode(markup: string, name: string): string {
  const match = markup.match(new RegExp(`<g[^>]*data-command="${name}"[^>]*>`, 'u'))
  if (match === null) throw new Error(`缺少命令节点 ${name}`)
  return match[0]
}

describe('流程帮助', () => {
  it('默认打开第一张图，页签数量与顺序由流程定义决定', () => {
    const markup = render()
    const first = FLOW_DIAGRAMS[0]
    if (first === undefined) throw new Error('流程定义里没有图')

    expect(count(markup, 'data-testid="flow-tab-')).toBe(FLOW_DIAGRAMS.length)
    expect(markup).toContain(`aria-label="${first.title}"`)
    expect(markup).toContain(`data-testid="flow-tab-${first.id}" aria-selected="true"`)
  })

  it('一次只渲染一张图，图内没有可点击元素', () => {
    const markup = render()
    const start = markup.indexOf('<svg')
    const end = markup.indexOf('</svg>')
    if (start === -1 || end === -1) throw new Error('没有渲染流程图')

    const svg = markup.slice(start, end)
    expect(count(markup, 'role="img"')).toBe(1)
    expect(svg).not.toContain('<button')
    expect(svg).not.toContain('<a ')
    expect(svg).not.toContain('href=')
  })

  it('「实现之后」先评审再写 PR，两个命令都停，终态不停', () => {
    const markup = render('after-implement')

    expect(count(markup, 'role="img"')).toBe(1)
    expect(markup).toContain('aria-label="实现之后"')
    expect(markup).not.toContain('aria-label="入池与 triage"')
    expect(markup.indexOf('data-command="code-review"')).toBeLessThan(
      markup.indexOf('data-command="pr"'),
    )
    expect(markup).not.toContain('mattwf-code-review')

    for (const name of ['code-review', 'pr'] as const) {
      const node = commandNode(markup, name)
      expect(node).toContain('data-owner="matt"')
      expect(node).toContain('data-stops="true"')
    }
    expect(count(markup, 'data-testid="flow-stop"')).toBe(2)

    const terminal = markup.match(
      /<g[^>]*data-stops="false"[^>]*>(?:(?!<\/g>)[\s\S])*已合并、票已关闭(?:(?!<\/g>)[\s\S])*<\/g>/u,
    )
    if (terminal === null) throw new Error('没有渲染「已合并、票已关闭」终态')
    expect(terminal[0]).not.toContain('data-testid="flow-stop"')
  })

  it('流程定义里的每条命令都出现在某张图的节点里', () => {
    const shown = new Set(
      FLOW_DIAGRAMS.flatMap((diagram) =>
        diagram.rows.flatMap((row) =>
          row.nodes
            .map((node) => node.command)
            .filter((command): command is FlowCommandId => command !== null),
        ),
      ),
    )

    expect([...shown].sort()).toEqual(Object.keys(FLOW_COMMANDS).sort())
  })
})
