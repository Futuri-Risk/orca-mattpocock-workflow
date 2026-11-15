/**
 * 防回归守卫：面板与流程定义里不许再出现写死的中文界面文案。
 *
 * 用 TypeScript 的 AST 而不是正则扫源码：
 * - 注释里的中文不参与判定（注释不是字面量节点）；
 * - 模板字符串里的中文会被检查；
 * - JSX 文本节点会被检查。
 *
 * 白名单只有消息目录与追踪标签：目录本身就是中文的来源，
 * 标签名是跟踪器里的产品契约，必须原样保留。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = resolve(import.meta.dirname, '..')
const REPO = resolve(SRC, '..')

/** 目录与标签是允许保留中文的两处。 */
const WHITELIST = new Set([
  join(SRC, 'protocol', 'i18n.ts'),
  join(SRC, 'protocol', 'labels.ts'),
])

/** 面板里除测试外的全部源码；测试里的中文断言不属于界面文案。 */
function panelSources(directory: string): readonly string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...panelSources(path))
      continue
    }
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue
    files.push(path)
  }
  return files
}

function isTypePosition(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined) {
    if (ts.isLiteralTypeNode(current)) return true
    current = current.parent
  }
  return false
}

interface Violation {
  readonly file: string
  readonly line: number
  readonly text: string
}

function scan(file: string): readonly Violation[] {
  if (WHITELIST.has(file)) return []
  return scanSource(file, readFileSync(file, 'utf8'))
}

function scanSource(file: string, text: string): readonly Violation[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const violations: Violation[] = []

  const report = (node: ts.Node, literal: string): void => {
    if (!/\p{Script=Han}/u.test(literal)) return
    const start = source.getLineAndCharacterOfPosition(node.getStart(source))
    violations.push({
      file: relative(REPO, file),
      line: start.line + 1,
      text: literal.trim().slice(0, 80),
    })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isTypePosition(node)) report(node, node.text)
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      report(node, node.text)
    } else if (ts.isJsxText(node)) {
      report(node, node.text)
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return violations
}

describe('面板文案守卫', () => {
  it('能抓字面量、模板与 JSX 文本，忽略注释与类型', () => {
    const violations = scanSource(
      'sample.tsx',
      [
        '// 注释里的中文不算',
        'const a = "字面量"',
        'const b = `模板 ${a} 文本`',
        'const view = <span>JSX 文本</span>',
        "type T = '类型里的中文'",
      ].join('\n'),
    )

    expect(violations.map((violation) => violation.text)).toEqual([
      '字面量',
      '模板',
      '文本',
      'JSX 文本',
    ])
  })

  it('面板与流程定义里没有硬编码中文', () => {
    const files = [
      ...panelSources(join(SRC, 'panel')),
      join(SRC, 'protocol', 'flow.ts'),
      // 白名单文件被列进来后由 scan 跳过；漏掉白名单会立刻变成失败。
      ...WHITELIST,
    ]

    const violations = files.flatMap((file) => scan(file))

    expect(
      violations,
      violations
        .map((violation) => `${violation.file}:${String(violation.line)} ${violation.text}`)
        .join('\n'),
    ).toEqual([])
  })
})
