/**
 * 列表、详情时间线与分配人共用的用户头像。
 *
 * 有可用的 http(s) 地址时渲染远端图片；没有地址或图片加载失败时降级成登录名首字母色块。
 * 色块颜色只由登录名决定，所以同一个登录名在列表、正文、评论、分配人处是同一张脸。
 * 角色（创建人 / 评论作者 / 分配人）只进无障碍文本与悬浮说明，不改变外观。
 */
import * as React from 'react'

import {
  avatarColor,
  avatarHint,
  avatarInitial,
  avatarLabel,
  usableAvatarUrl,
  type AvatarRole,
  type AvatarUser,
} from './avatar-display.ts'
import type { AvatarSourceLoader } from './avatar-source.ts'
import { AVATAR_FALLBACK_STYLE, AVATAR_STYLE } from './ticket-row-styles.ts'

/** 没有外层加载器时的兜底：直接显示首字母色块。 */
const NO_AVATAR_SOURCE: AvatarSourceLoader = () => Promise.resolve(null)

/** 头像来源由面板根节点注入：同一张图在列表与详情共享一次请求。 */
const AvatarSourceContext = React.createContext<AvatarSourceLoader>(NO_AVATAR_SOURCE)

/** 为子树提供头像加载器（通常是向 worker 要 data URL 的那个）。 */
export function AvatarSourceProvider(props: {
  readonly loader: AvatarSourceLoader
  readonly children: React.ReactNode
}): React.ReactElement {
  return (
    <AvatarSourceContext.Provider value={props.loader}>
      {props.children}
    </AvatarSourceContext.Provider>
  )
}

/** 一次解析的结果：src 是原始远端地址，用它判断结果是否还属于当前用户。 */
interface ResolvedAvatar {
  readonly src: string
  readonly dataUrl: string | null
}

/** 头像依赖。 */
export interface UserAvatarProps {
  /** 远端用户；本地工单没有作者时为 null，显示中性色块。 */
  readonly user: AvatarUser | null
  /** 这个头像代表什么：创建人 / 评论作者 / 分配人 / 可分配用户。 */
  readonly role: AvatarRole
  /** 直径（像素）：列表 16、时间线 20、分配人 16、补全候选 18。 */
  readonly size: number
  /** 可选的外部测试标识；头像组件自己的标识固定加在这里。 */
  readonly testId?: string
}

/**
 * 渲染一个用户头像。
 * @param props - 用户、角色与尺寸。
 * @returns 远端图片或首字母色块。
 */
export function UserAvatar(props: UserAvatarProps): React.ReactElement {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null)
  const loader = React.useContext(AvatarSourceContext)
  const { user, size } = props
  const label = avatarLabel(props.role, user)
  const hint = avatarHint(user)
  const src = usableAvatarUrl(user?.avatarUrl ?? null)
  const [resolved, setResolved] = React.useState<ResolvedAvatar | null>(null)

  // 面板 frame 没有网络：地址先换成 worker 给的 data URL，再交给 <img>。
  React.useEffect(() => {
    if (src === null) {
      setResolved(null)
      return
    }
    let active = true
    void loader(src).then(
      (dataUrl) => {
        if (active) setResolved({ src, dataUrl })
      },
      () => {
        if (active) setResolved({ src, dataUrl: null })
      },
    )
    return () => {
      active = false
    }
  }, [loader, src])

  const dataUrl = resolved !== null && resolved.src === src ? resolved.dataUrl : null
  const box: React.CSSProperties = { ...AVATAR_STYLE, width: size, height: size }
  const testId = props.testId ?? 'user-avatar'

  if (src !== null && dataUrl !== null && src !== failedSrc) {
    return (
      <img
        data-testid={testId}
        src={dataUrl}
        alt={label}
        aria-label={label}
        title={hint}
        style={box}
        onError={() => {
          setFailedSrc(src)
        }}
      />
    )
  }

  return (
    <span
      data-testid={testId}
      role="img"
      aria-label={label}
      title={hint}
      style={{
        ...box,
        ...AVATAR_FALLBACK_STYLE,
        fontSize: Math.round(size * 0.56),
        lineHeight: `${String(size)}px`,
        background: avatarColor(user?.login ?? null),
      }}
    >
      {avatarInitial(user)}
    </span>
  )
}
