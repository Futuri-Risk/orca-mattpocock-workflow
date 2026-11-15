/**
 * 面板的界面语言：解析宿主语言、把设置值归一、插值、以及 React context 与 hook。
 *
 * 协议目录（`src/protocol/i18n.ts`）只放数据；这里放逻辑。面板只允许依赖
 * `src/protocol`，所以解析与插值不放进协议目录。
 *
 * 语言来源是一条插件设置 `language`：
 * - `zh-CN` / `en` 直接生效；
 * - `auto`、缺失或非法值回落到宿主的 BCP-47 界面语言，`zh*` → `zh-CN`，
 *   `en*` → `en`，其余（含空串）→ `zh-CN`，保持今天的中文默认。
 */
import * as React from 'react'

import {
  LANGUAGE_SETTING_KEY,
  LANGUAGE_SETTINGS,
  MESSAGES,
  type LanguageSetting,
  type Locale,
  type MessageId,
  type MessageParams,
  type Messages,
} from '../protocol/i18n.ts'
import { readFrame } from './host.ts'

/** 没有可识别宿主语言时的默认语言。 */
export const DEFAULT_LOCALE: Locale = 'zh-CN'

/**
 * 一条消息的参数：目录里声明了参数的消息必须传，没声明的消息不接受参数。
 * 参数缺项时插值保留占位符原文，绝不产出 `undefined` / `NaN`。
 */
export type MessageArgs<K extends MessageId> = K extends keyof MessageParams
  ? readonly [params: MessageParams[K]]
  : readonly []

/** 按消息 id 取文案的翻译函数；参数类型跟着消息 id 走。 */
export type Translate = <K extends MessageId>(
  id: K,
  ...args: MessageArgs<K>
) => string

/** 只匹配目录里约定的 `{name}` 占位符。 */
const PLACEHOLDER = /\{([A-Za-z0-9_.-]+)\}/g

/**
 * 把一条模板里的 `{name}` 换掉。
 * @param template - 目录里的原文。
 * @param params - 本次消息的参数；缺项保留占位符。
 * @returns 填好的文案。
 */
export function formatMessage(
  template: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  if (params === undefined) return template
  return template.replace(PLACEHOLDER, (match, rawName: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, rawName)) return match
    const value = params[rawName]
    if (value === undefined) return match
    if (typeof value === 'number' && !Number.isFinite(value)) return match
    return String(value)
  })
}

/**
 * 生成某个语言的翻译函数。
 * @param locale - 生效语言。
 * @returns 按消息 id 取文案的函数。
 */
export function createTranslator(locale: Locale): Translate {
  const messages = MESSAGES[locale]
  const translate = <K extends MessageId>(id: K, ...args: MessageArgs<K>): string => {
    const template = messages[id]
    const params = args[0] as Readonly<Record<string, string | number>> | undefined
    return formatMessage(template, params)
  }
  return translate
}

/**
 * 把设置值归一成允许的语言设置；非法值回落到 `auto`。
 * @param value - 设置里读到的原始值。
 * @returns `auto` / `zh-CN` / `en`。
 */
export function normalizeLanguageSetting(value: unknown): LanguageSetting {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if ((LANGUAGE_SETTINGS as readonly string[]).includes(trimmed)) {
      return trimmed as LanguageSetting
    }
  }
  return 'auto'
}

/**
 * 计算生效语言：设置值优先，`auto` 时按宿主语言标签前缀匹配。
 * @param setting - 插件设置值；缺失或非法时按 `auto` 处理。
 * @param hostLocale - 宿主界面语言（BCP-47）。
 * @returns 生效语言。
 */
export function resolveLocale(setting: unknown, hostLocale: unknown): Locale {
  const normalized = normalizeLanguageSetting(setting)
  if (normalized !== 'auto') return normalized

  const tag = typeof hostLocale === 'string' ? hostLocale.trim().toLowerCase() : ''
  if (tag.startsWith('zh')) return 'zh-CN'
  if (tag.startsWith('en')) return 'en'
  return DEFAULT_LOCALE
}

const TRANSLATORS: Readonly<Record<Locale, Translate>> = {
  'zh-CN': createTranslator('zh-CN'),
  en: createTranslator('en'),
}

/** 非 React 模块（传输层、剪贴板提示）在请求失败时取当前语言。 */
let activeLocale: Locale = DEFAULT_LOCALE

/**
 * 更新非 React 模块用的当前语言；由 {@link LocaleProvider} 在渲染时同步。
 * @param locale - 生效语言。
 */
export function setActiveLocale(locale: Locale): void {
  activeLocale = locale
}

/**
 * 当前语言的翻译函数。React 组件应优先用 {@link useMessages}；
 * 这个入口只给拿不到 context 的叶子模块用（错误消息在失败时才生成）。
 * @returns 当前语言的翻译函数。
 */
export function activeTranslate(): Translate {
  return TRANSLATORS[activeLocale]
}

/** 语言 context 的值。 */
export interface LocaleContextValue {
  readonly locale: Locale
  readonly messages: Messages
  /** 当前语言的翻译函数。 */
  readonly t: Translate
  /** 设置里的原始选择：`auto` / `zh-CN` / `en`。 */
  readonly setting: LanguageSetting
  /** 写入设置；面板内的切换器用它即时生效。 */
  readonly setSetting: (next: LanguageSetting) => void
}

const DEFAULT_CONTEXT: LocaleContextValue = {
  locale: DEFAULT_LOCALE,
  messages: MESSAGES[DEFAULT_LOCALE],
  t: TRANSLATORS[DEFAULT_LOCALE],
  setting: 'auto',
  setSetting: () => undefined,
}

const LocaleContext = React.createContext<LocaleContextValue>(DEFAULT_CONTEXT)

/**
 * 读取当前语言与翻译函数。
 * @returns 语言 context；没有 provider 时按默认中文，方便单测直接渲染组件。
 */
export function useLocale(): LocaleContextValue {
  return React.useContext(LocaleContext)
}

/**
 * 只取翻译函数的快捷入口。
 * @returns 当前语言的翻译函数。
 */
export function useMessages(): Translate {
  return React.useContext(LocaleContext).t
}

/**
 * 语言 provider：读设置、订阅变更、即时重渲染，并同步 `<html lang>`。
 * 设置还没读到时先不渲染子树，避免英文用户先闪一下中文。
 * @param props - 子树。
 * @returns 语言 context 的 provider。
 */
export function LocaleProvider(props: {
  readonly children?: React.ReactNode
}): React.ReactElement | null {
  const frame = readFrame()
  const settings = frame?.settings
  const hostLocale = frame?.locale ?? ''
  const [setting, setSetting] = React.useState<LanguageSetting | null>(
    settings === undefined ? 'auto' : null,
  )

  React.useEffect(() => {
    if (settings === undefined || typeof settings.get !== 'function') {
      setSetting('auto')
      return undefined
    }
    let current = true
    const load = (): void => {
      void settings.get(LANGUAGE_SETTING_KEY).then(
        (value) => {
          if (current) setSetting(normalizeLanguageSetting(value))
        },
        () => {
          // 设置读不到时回落到跟随宿主，不把面板卡在空白上。
          if (current) setSetting('auto')
        },
      )
    }
    load()
    const subscription =
      typeof settings.onDidChange === 'function'
        ? settings.onDidChange((change) => {
            if (change.key === LANGUAGE_SETTING_KEY) load()
          })
        : undefined
    return () => {
      current = false
      subscription?.dispose()
    }
  }, [settings])

  const locale = resolveLocale(setting ?? 'auto', hostLocale)
  const t = React.useMemo(() => TRANSLATORS[locale], [locale])

  // 布局 effect 早于所有被动 effect：子组件在 effect 里发的请求也能拿到正确语言。
  React.useLayoutEffect(() => {
    setActiveLocale(locale)
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale
    }
  }, [locale])

  const setLanguage = React.useCallback(
    (next: LanguageSetting): void => {
      setSetting(next)
      if (settings !== undefined && typeof settings.set === 'function') {
        void settings.set(LANGUAGE_SETTING_KEY, next).catch(() => {
          // 宿主拒绝写入时仍然按本次选择渲染；下次打开回落到存储里的值。
        })
      }
    },
    [settings],
  )

  const value = React.useMemo<LocaleContextValue>(
    () => ({
      locale,
      messages: MESSAGES[locale],
      t,
      setting: setting ?? 'auto',
      setSetting: setLanguage,
    }),
    [locale, setLanguage, setting, t],
  )

  if (setting === null) return null
  return React.createElement(LocaleContext.Provider, { value }, props.children)
}
