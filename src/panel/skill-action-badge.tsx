/**
 * 技能动作徽标：列表行与详情头部共用。
 *
 * 有技能动作（implement / diagnose / triage）时是一个按钮：点一下把这张票的
 * 提示词复制到剪贴板；剪贴板写不进去时面板自动给出手动复制区，所以按钮从不禁用。
 * 不可开工时换成原因徽标。判定在 core、worker 把结果附在快照上，
 * 这里只展示快照里的 `skillAction` 与 `skillActionReason`，不重新判定。
 */
import * as React from 'react'
import type { CSSProperties } from 'react'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import { CheckIcon, CopyIcon } from './icons.tsx'
import { actionBadgeLabel, actionHint } from './skill-action-text.ts'
import { ACTION_BADGE_STYLES, ACTION_TONES, SKILL_BADGE_BUTTON_STYLE } from './task-panel-styles.ts'

/** 技能动作徽标的依赖。 */
export interface SkillActionBadgeProps {
  readonly ticket: TicketSnapshot
  /** 这张票的提示词刚被复制。 */
  readonly copied: boolean
  /** 复制这张票的提示词。 */
  readonly onSkillAction: (ticket: TicketSnapshot) => void
  /** 版式位置（列表右列的对齐等）；按钮本体的样式不变。 */
  readonly style?: CSSProperties | undefined
}

/**
 * 渲染一张票的技能动作或原因徽标。
 * @param props - 工单、复制状态与复制回调。
 * @returns 技能动作按钮，或不可开工的原因徽标。
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

  const buttonHint = props.copied ? `${hint}；提示词已复制` : hint

  return (
    <button
      type="button"
      data-testid="skill-badge"
      data-ref={ticket.ref}
      {...(props.copied ? { 'data-copied': 'true' } : {})}
      data-hover="action"
      title={buttonHint}
      aria-label={`${label}：${buttonHint}`}
      onClick={(event) => {
        // 工单行整体可点：这个按钮只复制提示词，不打开详情。
        event.stopPropagation()
        props.onSkillAction(ticket)
      }}
      style={{
        ...SKILL_BADGE_BUTTON_STYLE,
        color: ACTION_TONES[ticket.skillActionReason],
        ...props.style,
      }}
    >
      {props.copied ? <CheckIcon /> : <CopyIcon />}
      {label}
    </button>
  )
}
