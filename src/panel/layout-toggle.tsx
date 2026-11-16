/**
 * 列表布局切换：平铺 / 父子。
 *
 * 父子能力为无时按钮不可用，但保留为可聚焦的原生按钮并带原因说明：
 * 读屏与悬停都能听到“为什么不能用”，不会被悄悄藏掉。
 */
import * as React from 'react'

import type { HierarchyAvailability } from './hierarchy-text.ts'
import { useMessages } from './i18n.ts'
import { CHIP_ACTIVE_STYLE, CHIP_STYLE, COLORS } from './task-panel-styles.ts'
import type { TicketLayout } from './ticket-tree.ts'

/** 布局切换依赖。 */
export interface LayoutToggleProps {
  /** 用户偏好里的布局；不可用时仍显示为选中。 */
  readonly layout: TicketLayout
  readonly hierarchy: HierarchyAvailability
  readonly onLayout: (layout: TicketLayout) => void
}

/** 平铺与父子的分段切换。 */
export function LayoutToggle(props: LayoutToggleProps): React.ReactElement {
  const t = useMessages()

  return (
    <div role="group" aria-label={t('tickets.layoutGroup')} style={GROUP_STYLE}>
      <LayoutButton
        testId="layout-flat"
        label={t('tickets.layout.flat')}
        active={props.layout === 'flat'}
        title={t('tickets.layout.flatHint')}
        onClick={() => {
          props.onLayout('flat')
        }}
      />
      <LayoutButton
        testId="layout-hierarchy"
        label={t('tickets.layout.hierarchy')}
        active={props.layout === 'hierarchy'}
        title={props.hierarchy.hint}
        disabled={!props.hierarchy.available}
        onClick={() => {
          props.onLayout('hierarchy')
        }}
      />
    </div>
  )
}

function LayoutButton(props: {
  readonly testId: string
  readonly label: string
  readonly active: boolean
  readonly title: string
  readonly disabled?: boolean
  readonly onClick: () => void
}): React.ReactElement {
  const disabled = props.disabled === true
  return (
    <button
      type="button"
      data-testid={props.testId}
      aria-pressed={props.active}
      aria-disabled={disabled ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      data-hover={disabled ? undefined : 'soft'}
      title={props.title}
      onClick={() => {
        // 不可用时保留焦点与说明，但不切换布局。
        if (!disabled) props.onClick()
      }}
      style={{
        ...CHIP_STYLE,
        ...(props.active ? CHIP_ACTIVE_STYLE : undefined),
        ...(disabled ? { opacity: 0.55, cursor: 'default' } : undefined),
      }}
    >
      {props.label}
    </button>
  )
}

const GROUP_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  padding: 2,
  borderRadius: 8,
  background: COLORS.track,
  flex: 'none',
}
