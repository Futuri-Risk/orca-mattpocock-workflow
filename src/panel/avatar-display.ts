/**
 * 头像的纯展示规则：地址白名单、可读的名字标签、悬浮说明与降级色块。
 *
 * 组件只负责把这些结果渲染成远端图片或首字母色块；规则放在这里，
 * 不引入 React 测试设施也能覆盖“同一登录名同一颜色”“非 http(s) 不加载”。
 */
import type { TicketAuthor } from '../protocol/tracker.ts'
import { authorName, authorTitle } from './author-text.ts'
import { AVATAR_COLORS } from './ticket-row-styles.ts'

/** 头像需要的用户字段；协议里的 `TicketAuthor` 直接满足。 */
export type AvatarUser = Pick<TicketAuthor, 'login' | 'displayName' | 'avatarUrl'>

/** 头像代表什么。角色只进无障碍文本与悬浮说明，不改变外观。 */
export type AvatarRole = '创建人' | '评论作者' | '分配人' | '可分配用户'

/** 没有用户时的中性色：本地 Markdown 的未署名评论。 */
const NEUTRAL_COLOR = AVATAR_COLORS[AVATAR_COLORS.length - 1] ?? '#424a53'

/**
 * 只放行 http(s) 的绝对地址。工单数据是不可信内容，界面不加载其它协议的地址；
 * 宿主已经做过一次同样的规范化，这里是第二道闸。
 * @param value - 后端给的头像地址。
 * @returns 可加载的地址，或不可用时的 null。
 */
export function usableAvatarUrl(value: string | null): string | null {
  if (value === null) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * 头像的可读名字标签：角色加展示名；没有展示名时退回登录名。
 * @param role - 这个头像代表什么：创建人 / 评论作者 / 分配人。
 * @param user - 远端用户；本地工单没有用户时为 null。
 * @returns 读屏软件念出来的名字。
 */
export function avatarLabel(role: AvatarRole, user: AvatarUser | null): string {
  return `${role}：${user === null ? '未署名' : authorName(user)}`
}

/**
 * 悬浮说明：展示名与登录名。没有展示名时只给登录名。
 * @param user - 远端用户。
 * @returns 悬停文案。
 */
export function avatarHint(user: AvatarUser | null): string {
  return user === null ? '未署名' : authorTitle(user)
}

/**
 * 降级色块的颜色：只由登录名决定，同一个用户在任意工作区、任意后端都是同一个颜色。
 * @param login - 登录名；没有用户时为 null。
 * @returns `#rrggbb` 颜色。
 */
export function avatarColor(login: string | null): string {
  if (login === null) return NEUTRAL_COLOR

  let hash = 0x811c9dc5
  for (const character of login) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? NEUTRAL_COLOR
}

/**
 * 色块里的首字母：沿用列表的规则，只取登录名首字；按字素取，
 * emoji 与组合字符不会被拆成半个。
 * @param user - 远端用户。
 * @returns 一个大写首字；没有用户时为 `?`。
 */
export function avatarInitial(user: AvatarUser | null): string {
  if (user === null) return '?'
  const first = new Intl.Segmenter().segment(user.login)[Symbol.iterator]().next()
  return first.done === true ? '?' : first.value.segment.trim().toUpperCase()
}
