/**
 * 父子布局的降级与覆盖提示。
 *
 * - 偏好为父子、但当前快照没有父子能力：说明已按平铺显示且偏好保留；
 * - 父子布局生效、但样本被窗口截断：说明关系只覆盖已加载的票。
 */
import * as React from 'react'

import type { WorkspaceSnapshot } from '../protocol/tracker.ts'
import { useMessages } from './i18n.ts'
import { COLORS } from './task-panel-styles.ts'
import type { TicketLayout } from './ticket-tree.ts'
import type { ViewPreference } from './view-preference.ts'

/** 父子提示依赖。 */
export interface HierarchyNoticeProps {
  readonly snapshot: WorkspaceSnapshot
  readonly preference: ViewPreference
  /** 实际生效的布局；父子能力为无时是平铺。 */
  readonly layout: TicketLayout
}

/** 降级或覆盖提示；都不适用时不渲染。 */
export function HierarchyNotice(props: HierarchyNoticeProps): React.ReactElement | null {
  const t = useMessages()

  // 偏好仍是父子、实际却降级为平铺：说明原因，并说明偏好没有丢。
  if (props.preference.layout === 'hierarchy' && props.layout !== 'hierarchy') {
    return (
      <div data-testid="hierarchy-fallback" style={NOTICE_STYLE}>
        {t('tickets.layout.fallback')}
      </div>
    )
  }

  if (props.layout === 'hierarchy' && props.snapshot.total > props.snapshot.loaded) {
    return (
      <div data-testid="hierarchy-coverage" style={NOTICE_STYLE}>
        {t('tickets.layout.coverage', {
          loaded: props.snapshot.loaded,
          total: props.snapshot.total,
        })}
      </div>
    )
  }

  return null
}

/** 一行小字，放在列表上方，不盖住工具栏。 */
const NOTICE_STYLE: React.CSSProperties = {
  color: COLORS.secondary,
  fontSize: 12,
  lineHeight: '18px',
  padding: '0 12px 6px',
}
