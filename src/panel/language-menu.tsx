/**
 * 语言切换：顶栏只放一个地球图标，点开是三选一的单选菜单。
 *
 * 原生下拉要按最长的文案（「跟随宿主（English）」）撑开，窄侧栏里会和页签抢宽度；
 * 图标按钮固定占一个图标的宽度，菜单展开时才有文字。写法沿用头部「更多」菜单：
 * 点外部收起、Esc 只收菜单不冒泡。
 */
import * as React from 'react'

import type { LanguageSetting } from '../protocol/i18n.ts'
import { useLocale, useMessages } from './i18n.ts'
import { CheckIcon, GlobeIcon } from './icons.tsx'
import { COLORS, ICON_BUTTON_STYLE } from './task-panel-styles.ts'

/** 顶栏的语言入口：图标按钮 + 单选菜单。 */
export function LanguageMenu(): React.ReactElement {
  const t = useMessages()
  const { setting, setSetting, locale } = useLocale()
  const [open, setOpen] = React.useState(false)
  const wrapper = React.useRef<HTMLDivElement>(null)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const menuId = React.useId()
  const languageName = locale === 'zh-CN' ? t('language.zhCN') : t('language.en')

  const options: readonly { readonly value: LanguageSetting; readonly label: string }[] = [
    { value: 'auto', label: t('language.autoEffective', { language: languageName }) },
    { value: 'zh-CN', label: t('language.zhCN') },
    { value: 'en', label: t('language.en') },
  ]

  React.useEffect(() => {
    if (!open) return
    // 点菜单外任意位置收起。
    const onPointer = (event: MouseEvent): void => {
      if (wrapper.current?.contains(event.target as Node) !== true) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  const close = (): void => {
    setOpen(false)
    trigger.current?.focus()
  }

  // 悬停说明只讲生效语言；「跟随宿主」在菜单里的选项上写清楚。
  const currentLabel = t('language.effective', { language: languageName })

  return (
    <div
      ref={wrapper}
      style={WRAPPER_STYLE}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          // 只收菜单，不冒泡到外层视图的快捷键。
          event.stopPropagation()
          close()
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        data-testid="language-menu"
        data-hover="soft"
        aria-label={t('language.label')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={currentLabel}
        onClick={() => {
          setOpen((value) => !value)
        }}
        style={TRIGGER_STYLE}
      >
        <GlobeIcon />
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label={t('language.label')} style={MENU_STYLE}>
          {options.map((option) => {
            const checked = option.value === setting
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                data-testid={`language-option-${option.value}`}
                data-hover="soft"
                aria-checked={checked}
                // 打开菜单时焦点落在当前选项上，键盘用户直接回车即选中。
                autoFocus={checked}
                onClick={() => {
                  setSetting(option.value)
                  close()
                }}
                style={ITEM_STYLE}
              >
                <span aria-hidden="true" style={CHECK_SLOT_STYLE}>
                  {checked ? <CheckIcon /> : null}
                </span>
                {option.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

const WRAPPER_STYLE: React.CSSProperties = {
  position: 'relative',
  flex: 'none',
}

const TRIGGER_STYLE: React.CSSProperties = ICON_BUTTON_STYLE

/** 贴右对齐的浮层：与头部「更多」菜单同一档阴影与圆角。 */
const MENU_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  right: 0,
  zIndex: 10,
  minWidth: 150,
  padding: 4,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  background: COLORS.surfaceRaised,
  boxShadow: '0 6px 16px rgba(0, 0, 0, 0.12)',
}

const ITEM_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  border: 'none',
  borderRadius: 4,
  padding: '5px 8px',
  color: COLORS.text,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

/** 勾选位固定宽度：没选中的项也占位，选项文字左边对齐。 */
const CHECK_SLOT_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 12,
  height: 12,
  color: COLORS.accent,
}
