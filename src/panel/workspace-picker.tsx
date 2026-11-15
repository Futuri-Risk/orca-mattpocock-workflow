/**
 * 工作区候选列表：认不到当前工作区时贴在面板顶部，让用户挑一个仓库目录。
 *
 * 每行都是一个明确的选择动作，并列出项目、名称、分支与路径——同一个分支上可能
 * 挂着多个工作区，只给名字没法区分。
 */
import * as React from 'react'

import { useMessages } from './i18n.ts'
import { COLORS } from './task-panel-styles.ts'
import type { WorkspaceCandidate } from './transport.ts'

/** 候选列表依赖。 */
export interface WorkspacePickerProps {
  readonly candidates: readonly WorkspaceCandidate[]
  /** 用户选定后带回工作区绝对路径。 */
  readonly onPick: (path: string) => void
}

/** 候选列表的样式：贴在面板顶部，不遮住视图。 */
const PICKER_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '8px 12px',
  borderBottom: `1px solid ${COLORS.border}`,
  color: COLORS.text,
  fontSize: 12,
}

const PICKER_TITLE_STYLE: React.CSSProperties = {
  color: COLORS.secondary,
}

const PICKER_BUTTON_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 1,
  width: '100%',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  padding: '5px 8px',
  background: 'transparent',
  color: COLORS.text,
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
  textAlign: 'left',
}

const PICKER_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
}

const PICKER_LABEL_STYLE: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const PICKER_USE_STYLE: React.CSSProperties = {
  flex: 'none',
  color: COLORS.accent,
}

const PICKER_PATH_STYLE: React.CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 11,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '100%',
}

/**
 * 渲染候选列表。每行点一下就选中该工作区。
 * @param props - 候选与选择回调。
 * @returns 候选选择区。
 */
export function WorkspacePicker(props: WorkspacePickerProps): React.ReactElement {
  const t = useMessages()

  return (
    <div data-testid="workspace-picker" style={PICKER_STYLE}>
      <span style={PICKER_TITLE_STYLE}>{t('workspace.pickerTitle')}</span>
      {props.candidates.map((candidate) => (
        <button
          key={candidate.id}
          type="button"
          data-testid="workspace-candidate"
          data-hover="soft"
          aria-label={t('workspace.useAria', { label: candidateLabel(candidate) })}
          onClick={() => {
            props.onPick(candidate.path)
          }}
          style={PICKER_BUTTON_STYLE}
        >
          <span style={PICKER_ROW_STYLE}>
            <span style={PICKER_LABEL_STYLE}>{candidateLabel(candidate)}</span>
            <span data-testid="workspace-candidate-use" style={PICKER_USE_STYLE}>
              {t('workspace.use')}
            </span>
          </span>
          <span style={PICKER_PATH_STYLE}>{candidate.path}</span>
        </button>
      ))}
    </div>
  )
}

/** 一行候选的标题：项目 · 名称 · 分支，缺项跳过。 */
function candidateLabel(candidate: WorkspaceCandidate): string {
  return [candidate.project, candidate.name, candidate.branch]
    .filter((part) => part.length > 0)
    .join(' · ')
}
