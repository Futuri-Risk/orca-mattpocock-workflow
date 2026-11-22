/**
 * 行内显示配置：一个图标按钮，点开浮层后决定列表行显示哪些字段。
 * 只改显示偏好，不动筛选、排序、选中票与快照请求；点浮层外任意处或按 Esc 收起。
 */
import * as React from 'react'

import type { MessageId } from '../protocol/i18n.ts'
import { useMessages } from './i18n.ts'
import { CheckIcon, DisplaySettingsIcon } from './icons.tsx'
import { COLORS } from './task-panel-styles.ts'
import {
  ROW_DISPLAY_CHECK_OFF_STYLE,
  ROW_DISPLAY_CHECK_STYLE,
  ROW_DISPLAY_ITEM_STYLE,
  ROW_DISPLAY_MENU_STYLE,
  ROW_DISPLAY_TRIGGER_STYLE,
  ROW_DISPLAY_WRAPPER_STYLE,
} from './ticket-row-styles.ts'
import type { RowField, RowFields } from './view-preference.ts'

/** 浮层里的字段顺序与文案：创建信息在前，可选字段在后，与行内从左到右一致。 */
const DISPLAY_ITEMS: readonly {
  readonly field: RowField
  readonly testId: string
  readonly messageId: MessageId
}[] = [
  { field: 'showAuthor', testId: 'display-author', messageId: 'tickets.row.author' },
  { field: 'showCreatedAt', testId: 'display-created', messageId: 'tickets.row.createdAt' },
  { field: 'showUpdatedAt', testId: 'display-updated', messageId: 'tickets.row.updatedAt' },
  { field: 'showAssignees', testId: 'display-assignees', messageId: 'tickets.row.assignees' },
]

/** 行内显示配置入口。 */
export interface RowDisplayControlProps {
  /** 行内各字段当前的显示开关。 */
  readonly fields: RowFields
  /** 当前后端是否有分配人概念；本地 Markdown 不出现这一项。 */
  readonly assigneesAvailable: boolean
  readonly onToggleField: (field: RowField) => void
}

/**
 * 工具栏里的「行内显示」浮层：四个平级的显示开关。
 * @param props - 当前开关、后端能力与切换回调。
 * @returns 图标按钮，展开时带字段开关浮层。
 */
export function RowDisplayControl(props: RowDisplayControlProps): React.ReactElement {
  const t = useMessages()
  const [open, setOpen] = React.useState(false)
  const wrapper = React.useRef<HTMLDivElement>(null)
  const trigger = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (!open) return undefined
    // 浮层没有遮罩：点浮层以外任意处收起，Esc 收起并把焦点还给图标按钮。
    const onPointerDown = (event: PointerEvent): void => {
      if (wrapper.current?.contains(event.target as Node) === true) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={wrapper} style={ROW_DISPLAY_WRAPPER_STYLE}>
      <button
        ref={trigger}
        type="button"
        data-testid="display-settings"
        data-hover="soft"
        aria-expanded={open}
        aria-label={t('tickets.row.trigger')}
        title={t('tickets.row.trigger')}
        onClick={() => {
          setOpen((value) => !value)
        }}
        style={{
          ...ROW_DISPLAY_TRIGGER_STYLE,
          ...(open ? { background: COLORS.surfaceActive, color: COLORS.text } : undefined),
        }}
      >
        <DisplaySettingsIcon />
      </button>
      {open ? (
        <div
          role="group"
          data-testid="display-menu"
          aria-label={t('tickets.row.trigger')}
          style={ROW_DISPLAY_MENU_STYLE}
        >
          {DISPLAY_ITEMS.filter(
            (item) => item.field !== 'showAssignees' || props.assigneesAvailable,
          ).map((item) => (
            <DisplayToggle
              key={item.field}
              testId={item.testId}
              label={t(item.messageId)}
              pressed={props.fields[item.field]}
              onToggle={() => {
                props.onToggleField(item.field)
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** 浮层里的一项：整行是按钮，`aria-pressed` 表示是否显示；开启只体现在末尾的对勾上。 */
function DisplayToggle(props: {
  readonly testId: string
  readonly label: string
  readonly pressed: boolean
  readonly onToggle: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={props.testId}
      data-hover="soft"
      aria-pressed={props.pressed}
      onClick={props.onToggle}
      style={ROW_DISPLAY_ITEM_STYLE}
    >
      {props.label}
      <span
        aria-hidden="true"
        style={props.pressed ? ROW_DISPLAY_CHECK_STYLE : ROW_DISPLAY_CHECK_OFF_STYLE}
      >
        <CheckIcon />
      </span>
    </button>
  )
}
