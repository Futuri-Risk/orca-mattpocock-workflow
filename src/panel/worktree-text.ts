/**
 * 「建 worktree」入口与结果区的中文文案。可用性判定在组件里，文案只在这里维护，
 * 与技能徽标、错误提示的文案模块保持同一种拆分。
 */
/** 不可建 worktree 的原因。 */
export const WORKTREE_REASONS = {
  closed: '工单已关闭',
  blocked: '还有未关闭的阻塞票',
  localOnly: '本地工单没有远端链接，无法挂到 worktree',
} as const

/**
 * 阻塞原因：有具体数量时写出来。
 * @param openBlockers - 未关闭的阻塞票数。
 * @returns 原因文案。
 */
export function blockedWorktreeReason(openBlockers: number): string {
  return openBlockers > 0
    ? `还有 ${String(openBlockers)} 张未关闭的阻塞票`
    : WORKTREE_REASONS.blocked
}

/**
 * 按钮文字。
 * @param busy - 请求进行中。
 * @param compact - 列表行里的紧凑版。
 * @returns 按钮文字。
 */
export function worktreeButtonLabel(busy: boolean, compact: boolean): string {
  if (busy) return '创建中…'
  return compact ? 'worktree' : '建 worktree'
}

/**
 * 按钮的悬停说明。
 * @param reason - 不可用的原因；可点时是 null。
 * @param busy - 请求进行中。
 * @returns 说明文字。
 */
export function worktreeButtonHint(reason: string | null, busy: boolean): string {
  if (reason !== null) return reason
  return busy ? '正在创建 worktree，请稍候' : '为这张工单创建 Orca worktree'
}

/**
 * 创建成功或命中既有工作区时的说明。
 * @param created - 本次是否新建。
 * @returns 一句结果说明。
 */
export function worktreeResultNotice(created: boolean): string {
  return created
    ? '已创建 worktree，Orca 已切到新工作区。'
    : '这张票已经有 worktree（已存在），没有重复创建。'
}

/** 结果区的固定标签与动作文案。 */
export const WORKTREE_RESULT_TEXT = {
  action: '建 worktree',
  branch: '分支',
  path: '路径',
  reference: '工单',
  copyPath: '复制路径',
  copiedPath: '已复制路径',
  copyFailed: '复制失败，请手动选中路径。',
  openEnvCheck: '查看环境检查',
} as const
