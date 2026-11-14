/**
 * 提示词复制的反馈区：一条状态说明，加上剪贴板失败时的手动复制框。
 *
 * 手动复制框是只读的，并在挂载后全选：用户按一次 ⌘C 就能复制，
 * 不必自己拖选。
 */
import * as React from 'react'

import type { PromptCopyState } from './injection.ts'
import { COLORS } from './task-panel-styles.ts'

/** 反馈区样式：贴在视图底部，不遮住列表。 */
const AREA_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '8px 12px',
  borderTop: `1px solid ${COLORS.border}`,
}

/** 状态说明。 */
const NOTICE_STYLE: React.CSSProperties = {
  color: COLORS.secondary,
  fontSize: 12,
  overflowWrap: 'anywhere',
}

/** 失败时的说明用警告色，和成功分开。 */
const NOTICE_ERROR_STYLE: React.CSSProperties = {
  ...NOTICE_STYLE,
  color: COLORS.warn,
}

/** 手动复制框：只读、可全选、等宽字体，保留原文换行。 */
const FIELD_STYLE: React.CSSProperties = {
  width: '100%',
  minHeight: '5em',
  padding: '6px 8px',
  border: `1px solid ${COLORS.borderStrong}`,
  borderRadius: 6,
  background: COLORS.surface,
  color: COLORS.text,
  font: 'inherit',
  fontSize: 12,
  lineHeight: 1.5,
  resize: 'vertical',
  userSelect: 'text',
}

/**
 * 渲染复制反馈与手动复制区。
 * @param props - 复制状态与可选的关闭回调。
 * @returns 反馈区；没有反馈时不渲染。
 */
export function PromptCopyArea(props: {
  readonly state: PromptCopyState
  readonly onDismiss?: (() => void) | undefined
}): React.ReactElement | null {
  const { state } = props
  if (state.notice === null && state.manual === null) return null

  return (
    <div style={AREA_STYLE}>
      {state.notice === null ? null : (
        <div
          role="status"
          data-testid="copy-notice"
          style={state.noticeTone === 'error' ? NOTICE_ERROR_STYLE : NOTICE_STYLE}
        >
          {state.notice}
        </div>
      )}
      {state.manual === null ? null : <ManualCopyField text={state.manual} />}
      {props.onDismiss === undefined ? null : (
        <button
          type="button"
          data-testid="copy-dismiss"
          data-hover="soft"
          onClick={props.onDismiss}
          style={DISMISS_STYLE}
        >
          收起
        </button>
      )}
    </div>
  )
}

/** 手动复制框：挂载后全选，用户直接 ⌘C。 */
function ManualCopyField(props: { readonly text: string }): React.ReactElement {
  const field = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    const node = field.current
    if (node === null) return
    node.focus()
    node.select()
  }, [])

  return (
    <textarea
      ref={field}
      data-testid="manual-copy"
      readOnly
      spellCheck={false}
      value={props.text}
      aria-label="提示词，手动复制"
      onFocus={(event) => {
        event.currentTarget.select()
      }}
      style={FIELD_STYLE}
    />
  )
}

/** 收起按钮。 */
const DISMISS_STYLE: React.CSSProperties = {
  alignSelf: 'flex-start',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  padding: '2px 8px',
  background: 'transparent',
  color: COLORS.secondary,
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
}
