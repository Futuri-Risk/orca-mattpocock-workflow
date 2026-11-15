/**
 * 工单的技能动作复制状态：列表行与详情头部的技能徽标共用。
 * 点击工单行只打开详情；复制提示词只由技能徽标和操作栏触发，
 * 这里记录最近一次复制成功的票，供界面区分“已复制”。
 */
import * as React from 'react'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import { usePromptCopy, type CopyResult, type PromptCopyState, type PromptCopy } from './injection.ts'
import { ticketPrompt } from './prompts.ts'

/** 列表与详情视图需要的复制状态与回调。 */
export interface TicketActionsState {
  /** 最近一次复制成功的工单 `ref`。 */
  readonly copied: string | null
  /** 复制反馈与手动复制区。 */
  readonly copyState: PromptCopyState
  /** 复制一段提示词。 */
  readonly copy: (text: string) => Promise<CopyResult>
  /** 清掉复制反馈。 */
  readonly dismiss: () => void
  /** 复制这张票的提示词。 */
  readonly onSkillAction: (ticket: TicketSnapshot) => void
}

/**
 * 管理工单提示词的复制。
 * @param workspaceRoot - 工作区变化时清空复制标记。
 * @param port - 面板的复制端口。
 * @returns 状态与回调。
 */
export function useTicketActions(
  workspaceRoot: string | undefined,
  port: PromptCopy,
): TicketActionsState {
  const [copied, setCopied] = React.useState<string | null>(null)
  const { state, copy, dismiss } = usePromptCopy(port)

  React.useEffect(() => {
    setCopied(null)
  }, [workspaceRoot])

  const onSkillAction = (ticket: TicketSnapshot): void => {
    const prompt = ticketPrompt(ticket)
    if (prompt === null) return
    void copy(prompt).then((result) => {
      setCopied(result.outcome === 'copied' ? ticket.ref : null)
    })
  }

  return { copied, copyState: state, copy, dismiss, onSkillAction }
}
