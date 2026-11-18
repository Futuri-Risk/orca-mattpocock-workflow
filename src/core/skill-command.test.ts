import { describe, expect, it } from 'vitest'

import { resolveSkillCommand, styleForAgents, toSkillCommandStyle } from './skill-command.ts'

describe('技能命令写法判定', () => {
  it('手动设置优先于探测与记住的值', () => {
    expect(
      resolveSkillCommand({ setting: 'omp', detected: 'codex', remembered: 'claude' }),
    ).toEqual({ style: 'omp', source: 'setting' })
  })

  it('设置是 auto 时按探测结果走', () => {
    expect(resolveSkillCommand({ setting: 'auto', detected: 'codex', remembered: 'claude' })).toEqual(
      { style: 'codex', source: 'detected' },
    )
  })

  it('没有 agent 在跑时用记住的值', () => {
    expect(resolveSkillCommand({ setting: 'auto', detected: null, remembered: 'omp' })).toEqual({
      style: 'omp',
      source: 'remembered',
    })
  })

  it('什么都没有时用默认写法', () => {
    expect(resolveSkillCommand({ setting: null, detected: null, remembered: null })).toEqual({
      style: 'claude',
      source: 'default',
    })
  })

  it('设置里的非法值当没有设置', () => {
    expect(toSkillCommandStyle('gemini')).toBeNull()
    expect(toSkillCommandStyle('auto')).toBeNull()
    expect(toSkillCommandStyle('codex')).toBe('codex')
  })

  it('按 agent 类型定写法', () => {
    expect(styleForAgents([{ kind: 'omp', state: 'working' }])).toBe('omp')
    expect(styleForAgents([{ kind: 'codex', state: 'working' }])).toBe('codex')
    expect(styleForAgents([{ kind: 'claude', state: 'working' }])).toBe('claude')
    expect(styleForAgents([{ kind: 'pi', state: 'working' }])).toBe('omp')
  })

  it('认不出的 agent 类型不投票', () => {
    expect(styleForAgents([{ kind: 'cursor', state: 'working' }])).toBeNull()
  })

  it('同时跑着两种写法算歧义', () => {
    expect(
      styleForAgents([
        { kind: 'omp', state: 'working' },
        { kind: 'codex', state: 'working' },
      ]),
    ).toBeNull()
  })

  it('正在跑的 agent 优先于已经结束的那些', () => {
    expect(
      styleForAgents([
        { kind: 'claude', state: 'done' },
        { kind: 'omp', state: 'working' },
      ]),
    ).toBe('omp')
  })

  it('只有结束的 agent 时用它们的写法', () => {
    expect(styleForAgents([{ kind: 'codex', state: 'done' }])).toBe('codex')
  })
})
