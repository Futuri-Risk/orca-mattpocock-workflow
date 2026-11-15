/**
 * 远端用户的展示文本。列表行、详情标题、时间线与头像 tooltip 共用这一份推导，
 * 避免同一行出现两套名字或两套悬停说明。
 */
import type { TicketAuthor } from '../protocol/tracker.ts'

/** 展示名字只需要用户名与展示名；候选用户没有头像字段。 */
export type NamedUser = Pick<TicketAuthor, 'login' | 'displayName'>

/**
 * 行内显示的名字：有展示名时用展示名，否则退回登录名。
 * @param user - 远端用户。
 * @returns 可展示的名字。
 */
export function authorName(user: NamedUser): string {
  return user.displayName ?? user.login
}

/**
 * 悬停时的完整信息：展示名加登录名；没有展示名时只给登录名。
 * @param user - 远端用户。
 * @returns 悬停文案。
 */
export function authorTitle(user: NamedUser): string {
  return user.displayName === null ? `@${user.login}` : `${user.displayName}（@${user.login}）`
}
