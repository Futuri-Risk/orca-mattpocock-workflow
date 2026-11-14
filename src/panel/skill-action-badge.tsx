/**
 * 技能动作徽标：列表行与详情头部共用。
 *
 * 有技能动作（implement / diagnose / triage）时是分裂动作：主键把这张票的
 * 提示词复制到剪贴板，右侧小箭头给出只读、已全选的文本框供手动复制；
 * 不可开工时换成原因徽标。判定在 core、worker 把结果附在快照上，
 * 这里只展示快照里的 `skillAction` 与 `skillActionReason`，不重新判定。
 */
import * as React from 'react'
import type { CSSProperties } from 'react'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import { CheckIcon, CopyIcon } from './icons.tsx'
import { actionBadgeLabel, actionHint } from './skill-action-text.ts'
import { SplitAction } from './split-action.tsx'
import { ACTION_BADGE_STYLES, ACTION_TONES, SKILL_BADGE_BUTTON_STYLE } from './task-panel-styles.ts'

/** 技能动作徽标的依赖。 */
export interface SkillActionBadgeProps {
  readonly ticket: TicketSnapshot
  /** 这张票的提示词刚被复制。 */
  readonly copied: boolean
  /** 剪贴板是否可用；不可用时主键禁用，箭头照常可用。 */
  readonly canCopy: boolean
  /** 主键：复制这张票的提示词。 */
  readonly onSkillAction: (ticket: TicketSnapshot) => void
  /** 小箭头：展示手动复制区。 */
  readonly onManual: (ticket: TicketSnapshot) => void
  /** 版式位置（列表右列的对齐等）；按钮本体的样式不变。 */
  readonly style?: CSSProperties | undefined
}

/**
 * 渲染一张票的技能动作或原因徽标。
 * @param props - 工单、复制状态与两个回调。
 * @returns 分裂的技能动作，或不可开工的原因徽标。
 */
export function SkillActionBadge(props: SkillActionBadgeProps): React.ReactElement {
  const { ticket } = props
  const label = actionBadgeLabel(ticket)
  const hint = actionHint(ticket)

  if (ticket.skillAction === 'none') {
    return (
      <span
        data-testid="action-reason"
        data-ref={ticket.ref}
        title={hint}
        aria-label={`${label}：${hint}`}
        style={{ ...ACTION_BADGE_STYLES[ticket.skillActionReason], ...props.style }}
      >
        {label}
      </span>
    )
  }

  const buttonHint = badgeHint(hint, props.copied, props.canCopy)

  return (
    <SplitAction
      testId="skill-badge"
      primaryAttributes={{
        'data-ref': ticket.ref,
        ...(props.copied ? { 'data-copied': 'true' } : {}),
      }}
      label={label}
      icon={props.copied ? <CheckIcon /> : <CopyIcon />}
      title={buttonHint}
      ariaLabel={`${label}：${buttonHint}`}
      primaryStyle={{
        ...SKILL_BADGE_BUTTON_STYLE,
        color: ACTION_TONES[ticket.skillActionReason],
      }}
      primaryHover="action"
      disabled={!props.canCopy}
      manualTitle="手动复制这张工单的提示词"
      onPrimary={() => {
        props.onSkillAction(ticket)
      }}
      onManual={() => {
        props.onManual(ticket)
      }}
      compact
      style={props.style}
    />
  )
}

function badgeHint(hint: string, copied: boolean, canCopy: boolean): string {
  const parts = [hint]
  if (copied) parts.push('提示词已复制')
  if (!canCopy) parts.push('当前环境不能写入剪贴板，请用小箭头手动复制')
  return parts.join('；')
}
