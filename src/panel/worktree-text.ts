/**
 * 「建 worktree」入口与结果区的文案。可用性判定在组件里，文案只在消息目录维护，
 * 与技能徽标、错误提示的文案模块保持同一种拆分。
 */
import type { Translate } from './i18n.ts'

/**
 * 阻塞原因：有具体数量时写出来。
 * @param openBlockers - 未关闭的阻塞票数。
 * @param t - 当前语言的翻译函数。
 * @returns 原因文案。
 */
export function blockedWorktreeReason(openBlockers: number, t: Translate): string {
  return openBlockers > 0
    ? t('worktree.reason.blockedCount', { n: openBlockers })
    : t('worktree.reason.blocked')
}

/**
 * 按钮文字。
 * @param busy - 请求进行中。
 * @param compact - 列表行里的紧凑版。
 * @param t - 当前语言的翻译函数。
 * @returns 按钮文字。
 */
export function worktreeButtonLabel(busy: boolean, compact: boolean, t: Translate): string {
  if (busy) return t('worktree.busy')
  return compact ? t('worktree.actionCompact') : t('worktree.action')
}

/**
 * 按钮的悬停说明。
 * @param reason - 不可用的原因；可点时是 null。
 * @param busy - 请求进行中。
 * @param t - 当前语言的翻译函数。
 * @returns 说明文字。
 */
export function worktreeButtonHint(
  reason: string | null,
  busy: boolean,
  t: Translate,
): string {
  if (reason !== null) return reason
  return busy ? t('worktree.busyHint') : t('worktree.hint')
}

/**
 * 创建成功或命中既有工作区时的说明。
 * @param created - 本次是否新建。
 * @param t - 当前语言的翻译函数。
 * @returns 一句结果说明。
 */
export function worktreeResultNotice(created: boolean, t: Translate): string {
  return created ? t('worktree.notice.created') : t('worktree.notice.existing')
}
