/**
 * 正文渲染器的图片分支：只有宿主内联好的 `data:image/…` 才渲染成 `img`，
 * 其它后端的正文行为保持原样。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MarkdownBody } from './markdown-body.tsx'

const DATA_URL = 'data:image/png;base64,iVBORw0KGgo='

function render(source: string, allowInlineImages?: boolean): string {
  return renderToStaticMarkup(
    <MarkdownBody
      source={source}
      {...(allowInlineImages === undefined ? {} : { allowInlineImages })}
    />,
  )
}

describe('MarkdownBody 图片', () => {
  it('宿主内联的 data URL 图片渲染成真实 img，而不是失效链接', () => {
    const markup = render(`![品控技术物流当月工资明细](${DATA_URL})`, true)

    expect(markup).toContain('<img')
    expect(markup).toContain(`src="${DATA_URL}"`)
    expect(markup).toContain('alt="品控技术物流当月工资明细"')
    // 用户报告的症状：`!` 加一个指向面板自身源的链接。
    expect(markup).not.toContain('!<a href="/uploads')
  })

  it('未启用内联的正文保持旧行为：`!` 加链接', () => {
    const markup = render('![pic](https://example.com/a.png)')

    expect(markup).not.toContain('<img')
    expect(markup).toContain('!<a href="https://example.com/a.png"')
    expect(markup).toContain('>pic</a>')
  })

  it('未启用内联时 data URL 也不进 img', () => {
    const markup = render(`![pic](${DATA_URL})`)

    expect(markup).not.toContain('<img')
    expect(markup).toContain('!pic')
  })

  it('危险协议的图片地址按文字显示，不生成 img', () => {
    const markup = render('![x](javascript:alert(1))', true)

    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('javascript:')
    expect(markup).toContain('!x')
  })

  it('普通链接与文本的渲染不变', () => {
    const markup = render('看 [文档](https://example.com/doc) 与 `![a](b)`。', true)

    expect(markup).toContain('<a href="https://example.com/doc"')
    expect(markup).toContain('<code>![a](b)</code>')
  })
})
