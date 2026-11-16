/**
 * 工单行元信息的样式：标签徽标、创建人头像与用户名、相对创建时间。
 * 从 task-panel-styles 拆出来，避免面板样式文件过长；颜色都走宿主主题变量。
 */
import type { CSSProperties } from 'react'

import { COLORS } from './task-panel-styles.ts'

/** 标题下的一行小字：状态在前、分类在后，都是次要信息。 */
export const CARD_META_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: 8,
  rowGap: 2,
  minWidth: 0,
}

/** 分类之外的标签：中性小徽标，不和状态徽标抢注意力。 */
export const LABEL_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 4,
  padding: '0 5px',
  color: COLORS.secondary,
  background: 'rgba(128, 128, 128, 0.12)',
  fontSize: 11,
  lineHeight: '17px',
  whiteSpace: 'nowrap',
}

/** 头像：16px 圆形裁切，行内不挤占标题与状态的位置。 */
export const AVATAR_STYLE: CSSProperties = {
  display: 'inline-block',
  width: 16,
  height: 16,
  borderRadius: '50%',
  objectFit: 'cover',
  flex: 'none',
  verticalAlign: 'middle',
}

/** 首字母色块的兜底样式：底色由登录名决定，文字固定白色。 */
export const AVATAR_FALLBACK_STYLE: CSSProperties = {
  color: '#fff',
  fontSize: 9,
  fontWeight: 600,
  lineHeight: '16px',
  textAlign: 'center',
  textTransform: 'uppercase',
  userSelect: 'none',
}

/** 首字母色块的固定配色：都够深，白字在深浅两套主题下都可读。 */
export const AVATAR_COLORS: readonly string[] = [
  '#0550ae',
  '#116329',
  '#6639ba',
  '#a40e6b',
  '#953800',
  '#424a53',
]

/** 创建人用户名：过长时省略，完整值放在 title 里。 */
export const AUTHOR_NAME_STYLE: CSSProperties = {
  maxWidth: '12ch',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: COLORS.secondary,
  fontSize: 11,
  lineHeight: '18px',
}

/** 行内的相对创建时间。 */
export const ROW_AGE_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 11,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
}

/**
 * 折叠按钮：真正的原生按钮，放在卡片左侧的独立槽位里。
 * 尺寸固定，折叠与展开只换箭头，不让标题左右跳动。
 */
export const COLLAPSE_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 18,
  height: 20,
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: COLORS.secondary,
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 10,
  lineHeight: '20px',
}

/** 叶子行占住折叠按钮的位置，让同层的标题左缘对齐。 */
export const COLLAPSE_SPACER_STYLE: CSSProperties = {
  width: 18,
  height: 20,
  flex: 'none',
}

/** 父子模式的行内容：折叠槽位 + 行按钮，整体仍是卡片的一列。 */
export const CARD_MAIN_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 4,
  minWidth: 0,
}

/** 父级不在列表时的徽标：沿用标签徽标，但允许省略长引用。 */
export const PARENT_BADGE_STYLE: CSSProperties = {
  ...LABEL_BADGE_STYLE,
  maxWidth: '26ch',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
