import { describe, expect, it } from 'vitest'

import { newBugPrompt, newFeaturePrompt, ticketPrompt } from './prompts.ts'
import type { Translate } from './i18n.ts'

/** 只关心命令行的测试：把槽位原样回显成键名。 */
const t = ((id: string) => id) as unknown as Translate

describe('面板提示词', () => {
  it('Claude Code 写法是斜杠命令加工单引用', () => {
    expect(ticketPrompt({ ref: '#40', skillAction: 'implement' }, 'claude')).toBe('/implement #40')
  })

  it('omp 写法是 /skill: 命令加工单引用', () => {
    expect(ticketPrompt({ ref: '#40', skillAction: 'implement' }, 'omp')).toBe(
      '/skill:implement #40',
    )
  })

  it('Codex 写法是 $ 提及加工单引用', () => {
    expect(ticketPrompt({ ref: '#40', skillAction: 'implement' }, 'codex')).toBe('$implement #40')
  })

  it('不可开工的票没有提示词', () => {
    expect(ticketPrompt({ ref: '#40', skillAction: 'none' }, 'omp')).toBeNull()
  })

  it('入池提示词在 Claude Code 下是命令加槽位', () => {
    const prompt = newFeaturePrompt(t, 'claude')
    expect(prompt.split('\n')[0]).toBe('/mattwf-feature')
    expect(prompt.split('\n')[1]).toBe('')
  })

  it('omp 只展开命令名后紧跟空格的那一条命令', () => {
    const prompt = newBugPrompt(t, 'omp')
    // 名字到第一个空格为止：命令名后必须紧跟一个空格，槽位在它之后。
    expect(prompt.startsWith('/skill:mattwf-bug ')).toBe(true)
    expect(prompt.split(' ')[0]).toBe('/skill:mattwf-bug')
  })

  it('Codex 的入池提示词用 $ 提及', () => {
    expect(newBugPrompt(t, 'codex').split('\n')[0]).toBe('$mattwf-bug')
  })
})
