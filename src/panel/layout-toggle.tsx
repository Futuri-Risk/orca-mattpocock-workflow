/**
 * 列表布局切换：平铺 / 父子。
 *
 * 参考面板现有语言：两个图标按钮放在「已加载」行右侧，不占工具栏宽度。
 * 父子能力为无时按钮不可用，但保留为可聚焦的原生按钮：悬停与读屏都能听到原因。
 */
import * as React from 'react'

import type { HierarchyAvailability } from './hierarchy-text.ts'
import { FlatListIcon, HierarchyIcon } from './icons.tsx'
import { useMessages } from './i18n.ts'
import { COLORS } from './task-panel-styles.ts'
import type { TicketLayout } from './ticket-tree.ts'

/** 布局切换依赖。 */
export interface LayoutToggleProps {
  /** 用户偏好里的布局；不可用时仍显示为选中。 */
  readonly layout: TicketLayout
  readonly hierarchy: HierarchyAvailability
  readonly onLayout: (layout: TicketLayout) => void
}

/** 平铺与父子的图标分段切换。 */
export function LayoutToggle(props: LayoutToggleProps): React.ReactElement {
  const t = useMessages()

  return (
    <div role="group" aria-label={t('tickets.layoutGroup')} style={GROUP_STYLE}>
      <LayoutButton
        testId="layout-flat"
        active={props.layout === 'flat'}
        title={t('tickets.layout.flatHint')}
        onClick={() => {
          props.onLayout('flat')
        }}
      >
        <FlatListIcon />
      </LayoutButton>
      <LayoutButton
        testId="layout-hierarchy"
        active={props.layout === 'hierarchy'}
        title={props.hierarchy.hint}
        disabled={!props.hierarchy.available}
        onClick={() => {
          props.onLayout('hierarchy')
        }}
      >
        <HierarchyIcon />
      </LayoutButton>
    </div>
  )
}

function LayoutButton(props: {
  readonly testId: string
  readonly active: boolean
  /** 同时作为可访问名称与悬停说明：图标没有可见文字。 */
  readonly title: string
  readonly disabled?: boolean
  readonly onClick: () => void
  readonly children: React.ReactNode
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
      aria-label={props.title}
      onClick={() => {
        // 不可用时保留焦点与说明，但不切换布局。
        if (!disabled) props.onClick()
      }}
      style={{
        ...BUTTON_STYLE,
        ...(props.active ? ACTIVE_BUTTON_STYLE : undefined),
        ...(disabled ? { opacity: 0.45, cursor: 'default' } : undefined),
      }}
    >
      {props.children}
    </button>
  )
}

const GROUP_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 1,
  padding: 1,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  background: COLORS.track,
  flex: 'none',
}

const BUTTON_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 22,
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: COLORS.tertiary,
  cursor: 'pointer',
  font: 'inherit',
}

const ACTIVE_BUTTON_STYLE: React.CSSProperties = {
  color: COLORS.text,
  background: COLORS.surfaceRaised,
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.12), 0 0 0 0.5px rgba(0, 0, 0, 0.08)',
}
