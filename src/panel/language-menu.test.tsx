// @vitest-environment happy-dom
/**
 * 顶栏语言入口：图标按钮 + 单选菜单。
 *
 * 断言落在外部行为上：面板里不再有原生下拉、点图标才出现三个选项、选中项写入
 * `language` 设置并即时换语言、Esc 只收菜单。设置桥用内存实现。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MESSAGES } from '../protocol/i18n.ts'
import { click, find, mustFind, render, settleWith, setupDom, teardownDom } from './dom-test-support.ts'
import { LocaleProvider } from './i18n.ts'
import { LanguageMenu } from './language-menu.tsx'

const ZH = MESSAGES['zh-CN']

let stored: string | undefined
const set = vi.fn(async (key: string, value: unknown) => {
  if (key === 'language') stored = String(value)
})

beforeEach(() => {
  setupDom()
  stored = 'auto'
  set.mockClear()
  window.orca = {
    locale: 'zh-CN',
    settings: {
      get: async (key: string) => (key === 'language' ? stored : undefined),
      set,
      delete: async () => undefined,
      keys: async () => ['language'],
      onDidChange: () => ({ dispose: () => undefined }),
    },
  } as unknown as NonNullable<Window['orca']>
})

afterEach(async () => {
  await teardownDom()
  delete window.orca
})

function menu() {
  return (
    <LocaleProvider>
      <LanguageMenu />
    </LocaleProvider>
  )
}

function option(value: string): HTMLElement {
  return mustFind(`language-option-${value}`)
}

describe('语言图标菜单', () => {
  it('顶栏只有一个图标按钮，默认不展开选项，也没有原生下拉', async () => {
    await render(menu())

    const trigger = mustFind('language-menu')
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger.getAttribute('aria-label')).toBe(ZH['language.label'])
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.querySelector('svg')).not.toBeNull()
    expect(document.querySelector('select')).toBeNull()
    expect(find('language-option-auto')).toBeNull()
  })

  it('点开是三个单选，当前项带勾选标记', async () => {
    await render(menu())
    await click(mustFind('language-menu'))

    expect(mustFind('language-menu').getAttribute('aria-expanded')).toBe('true')
    expect(mustFind('language-menu').getAttribute('title')).toBe(
      ZH['language.effective'].replace('{language}', ZH['language.zhCN']),
    )
    expect(option('auto').getAttribute('role')).toBe('menuitemradio')
    expect(option('auto').getAttribute('aria-checked')).toBe('true')
    expect(option('zh-CN').getAttribute('aria-checked')).toBe('false')
    expect(option('en').getAttribute('aria-checked')).toBe('false')
    expect(option('en').textContent).toContain(ZH['language.en'])
  })

  it('选中英文写设置、收起菜单并立即换成英文', async () => {
    await render(menu())
    await click(mustFind('language-menu'))
    await click(option('en'))

    expect(set).toHaveBeenCalledWith('language', 'en')
    expect(stored).toBe('en')
    expect(find('language-option-en')).toBeNull()
    expect(mustFind('language-menu').getAttribute('aria-label')).toBe(MESSAGES.en['language.label'])
    expect(mustFind('language-menu').getAttribute('title')).toBe(
      MESSAGES.en['language.effective'].replace('{language}', MESSAGES.en['language.en']),
    )
  })

  it('Esc 只收菜单，再点图标还能重新展开', async () => {
    await render(menu())
    await click(mustFind('language-menu'))
    expect(find('language-option-auto')).not.toBeNull()

    await settleWith(() => {
      mustFind('language-menu').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })

    expect(find('language-option-auto')).toBeNull()
    await act(async () => {
      mustFind('language-menu').click()
    })
    expect(find('language-option-auto')).not.toBeNull()
  })
})
