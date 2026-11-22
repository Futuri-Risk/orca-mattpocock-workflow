/**
 * 工单行相关的样式：元信息徽标、创建人、相对时间、分配人，
 * 以及工具栏「行内显示」浮层。从 task-panel-styles 拆出来，避免面板样式文件过长；
 * 颜色都走宿主主题变量。
 */
import type { CSSProperties } from 'react'

import { COLORS } from './task-panel-styles.ts'
import { MENU_STYLE, MENU_WRAPPER_STYLE } from './ticket-timeline-styles.ts'

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

/** 行内的相对时间：创建与更新两段共用一套说法与层级。 */
export const ROW_AGE_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 11,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
}

/** 分配人区：小人图标与登录名排成一组，随元信息行换行。 */
export const ASSIGNEE_GROUP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
}

/** 分配人区的前导图标：字段标识，不带文字语义。 */
export const ASSIGNEE_ICON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  flex: 'none',
  color: COLORS.tertiary,
  lineHeight: '18px',
}

/** 分配人登录名：裸远端用户名，窄侧栏下不截断。 */
export const ASSIGNEE_NAME_STYLE: CSSProperties = {
  color: COLORS.secondary,
  fontSize: 11,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
}

/** 分配人超过显示上限时的 `+N`，完整名单在悬停说明里。 */
export const ASSIGNEE_MORE_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 11,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
  cursor: 'default',
}

/** 工具栏里的「行内显示」入口：和排序下拉同高，图标不占工具栏宽度。 */
export const ROW_DISPLAY_TRIGGER_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  padding: '1px 6px',
  color: COLORS.secondary,
  background: COLORS.surfaceRaised,
  cursor: 'pointer',
  font: 'inherit',
  lineHeight: '20px',
}

/** 图标按钮与浮层共用定位上下文。 */
export const ROW_DISPLAY_WRAPPER_STYLE: CSSProperties = {
  ...MENU_WRAPPER_STYLE,
  display: 'inline-flex',
}

/** 浮层：贴着入口向右下展开，盖住列表。 */
export const ROW_DISPLAY_MENU_STYLE: CSSProperties = {
  ...MENU_STYLE,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 132,
}

/** 浮层里的一项：整行按钮，开启只体现在末尾的对勾上，不给整行加底色。 */
export const ROW_DISPLAY_ITEM_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  width: '100%',
  border: 'none',
  borderRadius: 6,
  padding: '4px 8px',
  background: 'transparent',
  color: COLORS.text,
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
  lineHeight: '18px',
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

/** 勾选标记：开启时显示在行尾。 */
export const ROW_DISPLAY_CHECK_STYLE: CSSProperties = {
  display: 'inline-flex',
  color: COLORS.accent,
  flex: 'none',
}

/** 未开启时保留勾的位置，切换开关时文字不左右跳动。 */
export const ROW_DISPLAY_CHECK_OFF_STYLE: CSSProperties = {
  ...ROW_DISPLAY_CHECK_STYLE,
  visibility: 'hidden',
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
