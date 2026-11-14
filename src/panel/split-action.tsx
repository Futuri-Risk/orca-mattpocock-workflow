/**
 * 分裂动作：主键把提示词复制到剪贴板，右侧窄箭头直接给出只读、已全选的文本框，
 * 让用户手动 ⌘C。顶部两个入池按钮与工单行内的技能徽标共用这个控件，
 * 交互与无障碍说明只有一份。
 *
 * 箭头是直接动作，不是菜单：一次点击就选定复制方式。剪贴板不可用时主键变灰，
 * 箭头照常可用——手动复制不依赖任何宿主能力。
 */
import * as React from 'react'
import type { CSSProperties, ReactNode } from 'react'

import { CopyIcon } from './icons.tsx'
import { SPLIT_DISABLED_STYLE } from './task-panel-styles.ts'

/**
 * 分裂动作：主键与小箭头并排成一组，共用边框、底色和圆角。
 * 外层不换行；箭头不参与收缩，窄侧栏里只有主键文字会截断。
 */
const GROUP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'stretch',
  flex: 'none',
  whiteSpace: 'nowrap',
}

/** 主键左圆角、箭头右圆角；中缝只留箭头左侧一条分隔线。 */
const PRIMARY_STYLE: CSSProperties = {
  borderRadius: '6px 0 0 6px',
  borderRight: 'none',
}

const SEAM_COLOR = 'color-mix(in srgb, currentColor 35%, transparent)'

const ARROW_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
  flex: 'none',
  width: 20,
  padding: 0,
  borderWidth: 1,
  borderStyle: 'solid',
  borderRadius: '0 6px 6px 0',
  cursor: 'pointer',
  font: 'inherit',
}

/** 工单行里的徽标保持 22px 高，箭头比顶部按钮更窄。 */
const ARROW_COMPACT_STYLE: CSSProperties = {
  width: 16,
  height: 22,
}

/** 分裂动作的依赖。 */
export interface SplitActionProps {
  /** 主键的 `data-testid`；小箭头固定用 `${testId}-manual`。 */
  readonly testId: string
  readonly label: ReactNode
  /** 主键前的图标。 */
  readonly icon?: ReactNode
  readonly title: string
  readonly ariaLabel: string
  readonly primaryStyle: CSSProperties
  /** 与面板样式表的悬停约定一致。 */
  readonly primaryHover: 'primary' | 'secondary' | 'action'
  /** 剪贴板不可用时主键禁用；箭头不受影响。 */
  readonly disabled: boolean
  /** 小箭头的说明。 */
  readonly manualTitle: string
  /** 主键：复制到剪贴板。 */
  readonly onPrimary: () => void
  /** 小箭头：展示手动复制区。 */
  readonly onManual: () => void
  /** 工单行里的紧凑版：22px 高、箭头更窄。 */
  readonly compact?: boolean
  /** 版式位置；两组分裂动作的按钮本体不变。 */
  readonly style?: CSSProperties | undefined
  /** 主键上的额外数据属性（例如定位用的 `data-ref`）。 */
  readonly primaryAttributes?: Readonly<Record<string, string>>
}

/**
 * 渲染一组分裂动作。
 * @param props - 文案、样式、可用性与两个回调。
 * @returns 主键加小箭头。
 */
export function SplitAction(props: SplitActionProps): React.ReactElement {
  return (
    <div
      data-split-group=""
      data-testid={`${props.testId}-group`}
      style={{ ...GROUP_STYLE, ...props.style }}
    >
      <button
        type="button"
        data-testid={props.testId}
        {...props.primaryAttributes}
        data-hover={props.primaryHover}
        disabled={props.disabled}
        title={props.title}
        aria-label={props.ariaLabel}
        onClick={(event) => {
          // 工单行整体可点：分裂动作只执行自己的动作，不打开详情。
          event.stopPropagation()
          props.onPrimary()
        }}
        style={{
          ...props.primaryStyle,
          ...PRIMARY_STYLE,
          ...(props.disabled ? SPLIT_DISABLED_STYLE : undefined),
        }}
      >
        {props.icon}
        {props.label}
      </button>
      <button
        type="button"
        data-testid={`${props.testId}-manual`}
        data-hover={props.primaryHover}
        title={props.manualTitle}
        aria-label={props.manualTitle}
        onClick={(event) => {
          event.stopPropagation()
          props.onManual()
        }}
        style={arrowStyle(props)}
      >
        <CopyIcon />
      </button>
    </div>
  )
}

function arrowStyle(props: SplitActionProps): CSSProperties {
  const primary = props.primaryStyle
  return {
    ...ARROW_STYLE,
    ...(props.compact === true ? ARROW_COMPACT_STYLE : undefined),
    // 与主键共用底色、描边和文字色，读起来是一整个动作。
    ...(primary.color === undefined ? undefined : { color: primary.color }),
    ...(primary.borderColor === undefined ? undefined : { borderColor: primary.borderColor }),
    ...(primary.background === undefined ? undefined : { background: primary.background }),
    // 分隔线跟随文字色淡化：实心按钮上是浅白线，描边按钮上是淡错误色线。
    borderLeftColor: SEAM_COLOR,
  }
}