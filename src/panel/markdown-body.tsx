/**
 * 把工单正文与评论里的 Markdown 渲染成 React 元素。
 *
 * 只渲染不改写：原文原样交给解析器，不做任何替换。工单内容来自远端，按不可信输入处理：
 * 不解析原始 HTML（`<script>`、`<img onerror>` 等都按文字显示），链接地址只放行
 * http(s) 与 mailto，链接一律在新窗口打开，不在面板里跳转。
 *
 * 自己写解析器而不是引第三方库：插件不新增依赖，也就不必为一段渲染引入供应链。
 */
import * as React from 'react'

import { MARKDOWN_ATTRIBUTE } from './task-panel-styles.ts'

/**
 * 行内标记：图片、代码、粗体、斜体、删除线、链接与自动链接。链接的地址允许一层括号。
 * 每次调用都新建正则：行内解析会递归（粗体里还能有代码），
 * 共用同一个带 lastIndex 的正则会从头再匹配，陷入死循环。
 * @returns 新的行内匹配正则。
 */
function inlinePattern(): RegExp {
  return /(!\[[^\]]*\]\((?:[^()\s]|\([^()\s]*\))*\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~]+~~)|(\[[^\]]*\]\((?:[^()\s]|\([^()\s]*\))*\))|(<https?:\/\/[^>\s]+>)/g
}

/** 只放行这些协议的地址。 */
const SAFE_PROTOCOL = /^(https?:|mailto:)/i

/**
 * 宿主内联出来的位图 data URL。只认适配器会生成的几种位图与 base64 形态，
 * SVG 等可执行内容不进 `img`。
 */
const INLINE_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/]+={0,2}$/

/**
 * 渲染一段 Markdown；元素样式由面板样式表按 `data-markdown` 统一提供。
 * @param props - 原文与可选的测试标识。
 * @returns 渲染后的元素。
 */
export function MarkdownBody(props: {
  readonly source: string
  readonly testId?: string
  /**
   * 是否把宿主内联好的位图 data URL 渲染成 `img`。
   * 只有 GitLab 详情会内联附件，其它后端保持原有渲染。
   */
  readonly allowInlineImages?: boolean
}): React.ReactElement {
  const allowInlineImages = props.allowInlineImages === true
  const content = React.useMemo(
    () => renderMarkdown(props.source, allowInlineImages),
    [props.source, allowInlineImages],
  )

  return (
    <div data-testid={props.testId} {...{ [MARKDOWN_ATTRIBUTE]: '' }}>
      {content}
    </div>
  )
}

/** 把原文渲染成块级元素。 */
function renderMarkdown(source: string, allowInlineImages: boolean): React.ReactNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (line.trim().length === 0) {
      index += 1
      continue
    }

    const fence = /^```(.*)$/.exec(line)
    if (fence !== null) {
      const language = (fence[1] ?? '').trim()
      const body: string[] = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      blocks.push(
        <pre key={`code-${String(index)}`}>
          <code data-language={language}>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      const level = (heading[1] ?? '#').length
      const text = heading[2] ?? ''
      blocks.push(
        React.createElement(
          `h${String(level)}`,
          { key: `h-${String(index)}` },
          renderInline(text, allowInlineImages),
        ),
      )
      index += 1
      continue
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s-*_]*$/.test(line)) {
      blocks.push(<hr key={`hr-${String(index)}`} />)
      index += 1
      continue
    }

    if (/^\s*>/.test(line)) {
      const quoted: string[] = []
      while (index < lines.length && /^\s*>/.test(lines[index] ?? '')) {
        quoted.push((lines[index] ?? '').replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push(
        <blockquote key={`quote-${String(index)}`}>
          {renderMarkdown(quoted.join('\n'), allowInlineImages)}
        </blockquote>,
      )
      continue
    }

    if (isTableRow(line) && isTableRow(lines[index + 1] ?? '')) {
      const table = renderTable(lines, index, allowInlineImages)
      if (table !== null) {
        blocks.push(table.node)
        index = table.next
        continue
      }
    }

    if (isListItem(line)) {
      const list = renderList(lines, index, allowInlineImages)
      blocks.push(list.node)
      index = list.next
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index] ?? ''
      if (current.trim().length === 0) break
      if (isListItem(current) || /^(#{1,6})\s/.test(current) || /^```/.test(current)) break
      paragraph.push(current)
      index += 1
    }
    blocks.push(
      <p key={`p-${String(index)}`}>{renderInline(paragraph.join('\n'), allowInlineImages)}</p>,
    )
  }

  return blocks
}

/** 表格：表头 + 分隔行 + 数据行。 */
function renderTable(
  lines: readonly string[],
  start: number,
  allowInlineImages: boolean,
): { readonly node: React.ReactNode; readonly next: number } | null {
  const header = splitRow(lines[start] ?? '')
  const divider = splitRow(lines[start + 1] ?? '')
  if (header.length === 0 || divider.length !== header.length) return null
  if (!divider.every((cell) => /^:?-{1,}:?$/.test(cell))) return null

  const rows: string[][] = []
  let index = start + 2
  while (index < lines.length && isTableRow(lines[index] ?? '')) {
    rows.push(splitRow(lines[index] ?? ''))
    index += 1
  }

  return {
    node: (
      <table key={`table-${String(start)}`}>
        <thead>
          <tr>
            {header.map((cell, cellIndex) => (
              <th key={`th-${String(cellIndex)}`}>{renderInline(cell, allowInlineImages)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`tr-${String(rowIndex)}`}>
              {row.map((cell, cellIndex) => (
                <td key={`td-${String(cellIndex)}`}>{renderInline(cell, allowInlineImages)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    ),
    next: index,
  }
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith('|') && line.trim().endsWith('|')
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/** 列表：无序与有序都支持，按缩进分层。 */
function renderList(
  lines: readonly string[],
  start: number,
  allowInlineImages: boolean,
): { readonly node: React.ReactNode; readonly next: number } {
  const ordered = /^\s*\d+[.)]\s/.test(lines[start] ?? '')
  const items: string[] = []
  let index = start

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim().length === 0) {
      // 空行后如果还是同类列表项，就继续；否则列表结束。
      const next = lines[index + 1] ?? ''
      if (!isListItem(next) || /^\s*\d+[.)]\s/.test(next) !== ordered) break
      items.push('')
      index += 1
      continue
    }
    if (!isListItem(line)) break
    if (/^\s*\d+[.)]\s/.test(line) !== ordered) break
    items.push(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''))
    index += 1
  }

  const children = items.map((item, itemIndex) => (
    <li key={`li-${String(itemIndex)}`}>
      {item.trim().length === 0 ? null : renderInline(item, allowInlineImages)}
    </li>
  ))

  return {
    node: ordered ? <ol key={`ol-${String(start)}`}>{children}</ol> : <ul key={`ul-${String(start)}`}>{children}</ul>,
    next: index,
  }
}

function isListItem(line: string): boolean {
  return /^\s*(?:[-*+]|\d+[.)])\s+/.test(line)
}

/** 行内标记：逐个匹配，未匹配的部分原样作为文本。 */
function renderInline(text: string, allowInlineImages: boolean): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let cursor = 0
  let key = 0

  const pattern = inlinePattern()
  let match = pattern.exec(text)
  while (match !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index))
    }
    const token = match[0]
    const node = renderToken(token, key, allowInlineImages)
    if (node !== null) nodes.push(node)
    key += 1
    cursor = match.index + token.length
    match = pattern.exec(text)
  }

  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

/** 一个行内标记；不认识的按文本处理。 */
function renderToken(
  token: string,
  key: number,
  allowInlineImages: boolean,
): React.ReactNode | null {
  if (token.startsWith('![')) {
    const parsed = /^!\[([^\]]*)\]\((.*)\)$/.exec(token)
    if (parsed === null) return token
    const alt = parsed[1] ?? ''
    const src = (parsed[2] ?? '').trim()
    if (allowInlineImages && INLINE_IMAGE.test(src)) {
      return <img key={`i-${String(key)}`} src={src} alt={alt} />
    }
    // 旧行为：`!` 后面跟一个链接；地址不安全时只显示文字。
    return (
      <React.Fragment key={`i-${String(key)}`}>
        !{isSafeUrl(src) ? <ExternalLink href={src}>{alt}</ExternalLink> : alt}
      </React.Fragment>
    )
  }
  if (token.startsWith('`') && token.endsWith('`')) {
    return <code key={`i-${String(key)}`}>{token.slice(1, -1)}</code>
  }
  if (token.startsWith('**') || token.startsWith('__')) {
    return (
      <strong key={`i-${String(key)}`}>
        {renderInline(token.slice(2, -2), allowInlineImages)}
      </strong>
    )
  }
  if (token.startsWith('~~')) {
    return (
      <del key={`i-${String(key)}`}>{renderInline(token.slice(2, -2), allowInlineImages)}</del>
    )
  }
  if (token.startsWith('*') || token.startsWith('_')) {
    return (
      <em key={`i-${String(key)}`}>{renderInline(token.slice(1, -1), allowInlineImages)}</em>
    )
  }
  if (token.startsWith('<')) {
    const url = token.slice(1, -1)
    return <ExternalLink key={`i-${String(key)}`} href={url}>{url}</ExternalLink>
  }
  if (token.startsWith('[')) {
    const parsed = /^\[([^\]]*)\]\((.*)\)$/.exec(token)
    if (parsed === null) return token
    const label = parsed[1] ?? ''
    const href = (parsed[2] ?? '').trim()
    if (!isSafeUrl(href)) return label
    return <ExternalLink key={`i-${String(key)}`} href={href}>{label}</ExternalLink>
  }
  return token
}

/** 只放行 http(s) 与 mailto；其它地址按文字显示。 */
function isSafeUrl(href: string): boolean {
  if (href.length === 0) return false
  if (href.startsWith('/') || href.startsWith('#')) return true
  return SAFE_PROTOCOL.test(href)
}

/** 外链一律新窗口打开，并断开 opener。 */
function ExternalLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>): React.ReactElement {
  return <a {...props} target="_blank" rel="noopener noreferrer" />
}
