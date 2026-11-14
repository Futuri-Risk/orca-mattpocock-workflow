/**
 * 工单的「建 worktree」入口：列表行与详情头部共用同一套可用性判定、按钮文案与结果区。
 *
 * 可用性只看快照里已有的判定，不另立规则：可接 / 其他开放可建；阻塞与已关闭禁用并说明原因；
 * 本地 Markdown 没有远端链接，不提供入口；认不到工作区时也不渲染。
 *
 * 创建成功后原地回报分支、绝对路径与挂上的链接；路径可一键复制。
 * 失败时给出可操作说明，命令行缺失再给「查看环境检查」入口。
 */
import * as React from 'react'
import type { CSSProperties } from 'react'

import type { BackendKind } from '../protocol/backend.ts'
import type { ErrorCode, RpcErrorBody, TicketSnapshot, TicketWorktreeResult } from '../protocol/tracker.ts'
import { copyText } from './clipboard.ts'
import { errorText, isEnvIssue } from './error-text.ts'
import { PlusIcon } from './icons.tsx'
import type { PanelClient } from './transport.ts'
import { BUTTON_STYLE, COLORS, SKILL_BADGE_BUTTON_STYLE } from './task-panel-styles.ts'
import {
  WORKTREE_REASONS,
  WORKTREE_RESULT_TEXT,
  blockedWorktreeReason,
  worktreeButtonHint,
  worktreeButtonLabel,
  worktreeResultNotice,
} from './worktree-text.ts'

/** 一个工单是否显示、是否可点建 worktree。 */
export interface WorktreeAvailability {
  /** 本地 Markdown 或没有工作区时不渲染入口。 */
  readonly visible: boolean
  readonly enabled: boolean
  /** 不可点的原因；可点时是 null。 */
  readonly reason: string | null
}

/**
 * 判定「建 worktree」入口的可用性。
 * @param ticket - 列表快照里的工单。
 * @param backend - 当前快照的后端。
 * @param workspaceRoot - 当前工作区；未确定时为 undefined。
 * @returns 是否显示、是否可点与禁用原因。
 */
export function worktreeAvailability(
  ticket: TicketSnapshot,
  backend: BackendKind,
  workspaceRoot: string | undefined,
): WorktreeAvailability {
  if (workspaceRoot === undefined) {
    return { visible: false, enabled: false, reason: null }
  }
  if (backend === 'markdown') {
    return {
      visible: true,
      enabled: false,
      reason: WORKTREE_REASONS.localOnly,
    }
  }
  if (ticket.status === 'closed') {
    return { visible: true, enabled: false, reason: WORKTREE_REASONS.closed }
  }
  if (ticket.status === 'blocked') {
    return {
      visible: true,
      enabled: false,
      reason: blockedWorktreeReason(ticket.openBlockers),
    }
  }
  return { visible: true, enabled: true, reason: null }
}

/** 一次创建请求的状态。 */
export interface WorktreeCreateState {
  readonly busy: boolean
  readonly error: RpcErrorBody | null
  readonly result: TicketWorktreeResult | null
  /** 发起创建；进行中重复调用会被忽略。 */
  readonly create: () => void
}

/**
 * 管一张票的 worktree 创建请求。
 * @param client - 面板客户端。
 * @param workspaceRoot - 当前工作区。
 * @param ticket - 要建 worktree 的工单。
 * @returns 请求状态与创建入口。
 */
export function useWorktreeCreate(
  client: PanelClient,
  workspaceRoot: string | undefined,
  ticket: TicketSnapshot,
): WorktreeCreateState {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<RpcErrorBody | null>(null)
  const [result, setResult] = React.useState<TicketWorktreeResult | null>(null)
  const running = React.useRef(false)
  // 换票或换工作区后，旧请求的响应不能覆盖新状态。
  const generation = React.useRef(0)

  React.useEffect(() => {
    generation.current += 1
    setBusy(false)
    setError(null)
    setResult(null)
    running.current = false
  }, [workspaceRoot, ticket.ref])

  const create = (): void => {
    if (running.current || workspaceRoot === undefined) return
    running.current = true
    const request = generation.current + 1
    generation.current = request
    setBusy(true)
    setError(null)

    void (async () => {
      try {
        const response = await client.createWorktree(workspaceRoot, ticket.ref, ticket.number)
        if (generation.current !== request) return
        if (response.ok) {
          setResult(response.result)
          return
        }
        setError(response.error)
      } finally {
        if (generation.current === request) {
          running.current = false
          setBusy(false)
        }
      }
    })()
  }

  return { busy, error, result, create }
}

/** 「建 worktree」按钮。禁用时把原因放在 title 与 aria-label 里。 */
export function WorktreeCreateButton(props: {
  readonly availability: WorktreeAvailability
  readonly busy: boolean
  readonly onClick: () => void
  /** 列表行里的紧凑版：22px 高、与技能徽标同排。 */
  readonly compact?: boolean
}): React.ReactElement | null {
  if (!props.availability.visible) return null
  const label = worktreeButtonLabel(props.busy, props.compact === true)
  const hint = worktreeButtonHint(props.availability.reason, props.busy)

  return (
    <button
      type="button"
      data-testid="worktree-create"
      data-hover="soft"
      disabled={!props.availability.enabled || props.busy}
      title={hint}
      aria-label={`${WORKTREE_RESULT_TEXT.action}：${hint}`}
      onClick={(event) => {
        // 工单行整体可点：这个动作不打开详情。
        event.stopPropagation()
        props.onClick()
      }}
      style={{
        ...(props.compact === true ? COMPACT_BUTTON_STYLE : BUTTON_STYLE),
        ...(props.availability.enabled ? undefined : DISABLED_LOOK_STYLE),
      }}
    >
      <PlusIcon />
      {label}
    </button>
  )
}

/**
 * 创建请求的原地回报：成功给出分支、路径与复制按钮，失败给出可操作说明。
 * @param props - 请求状态、错误跳转与紧凑版式。
 * @returns 结果区；没有结果也没有错误时不渲染。
 */
export function WorktreeOutcome(props: {
  readonly error: RpcErrorBody | null
  readonly result: TicketWorktreeResult | null
  readonly onOpenEnvCheck?: ((code: ErrorCode) => void) | undefined
  readonly compact?: boolean
}): React.ReactElement | null {
  if (props.error !== null) {
    const error = props.error
    return (
      <div
        role="alert"
        data-testid="worktree-error"
        style={{ ...ERROR_STYLE, ...(props.compact === true ? ERROR_COMPACT_STYLE : undefined) }}
      >
        <div>{errorText(error)}</div>
        {isEnvIssue(error.code) && props.onOpenEnvCheck !== undefined ? (
          <button
            type="button"
            data-testid="worktree-open-env"
            data-hover="soft"
            onClick={() => {
              props.onOpenEnvCheck?.(error.code)
            }}
            style={{ ...BUTTON_STYLE, marginTop: 4 }}
          >
            {WORKTREE_RESULT_TEXT.openEnvCheck}
          </button>
        ) : null}
      </div>
    )
  }

  if (props.result === null) return null
  return <WorktreeSuccess result={props.result} compact={props.compact === true} />
}

function WorktreeSuccess(props: {
  readonly result: TicketWorktreeResult
  readonly compact: boolean
}): React.ReactElement {
  const { result } = props
  const copied = useCopyPath(result.path)

  return (
    <div data-testid="worktree-result" style={props.compact ? RESULT_COMPACT_STYLE : RESULT_STYLE}>
      <div data-testid="worktree-notice" style={NOTICE_STYLE}>
        {worktreeResultNotice(result.created)}
      </div>
      <div style={LINE_STYLE}>
        <span style={LABEL_STYLE}>{WORKTREE_RESULT_TEXT.branch}</span>
        <code data-testid="worktree-branch" style={CODE_STYLE}>
          {result.branch}
        </code>
      </div>
      <div style={LINE_STYLE}>
        <span style={LABEL_STYLE}>{WORKTREE_RESULT_TEXT.path}</span>
        <code data-testid="worktree-path" style={CODE_STYLE}>
          {result.path}
        </code>
      </div>
      <div style={LINE_STYLE}>
        <span style={LABEL_STYLE}>{WORKTREE_RESULT_TEXT.reference}</span>
        <a
          data-testid="worktree-reference"
          href={result.reference}
          target="_blank"
          rel="noopener noreferrer"
          style={LINK_STYLE}
        >
          {result.reference}
        </a>
        <button
          type="button"
          data-testid="worktree-copy-path"
          data-hover="soft"
          onClick={() => {
            void copyText(result.path).then((outcome) => {
              copied.set(outcome.status === 'copied' ? 'copied' : 'failed')
            })
          }}
          style={COPY_BUTTON_STYLE}
        >
          {copied.state === 'copied'
            ? WORKTREE_RESULT_TEXT.copiedPath
            : WORKTREE_RESULT_TEXT.copyPath}
        </button>
        {copied.state === 'failed' ? (
          <span role="status" data-testid="worktree-copy-error" style={COPY_ERROR_STYLE}>
            {WORKTREE_RESULT_TEXT.copyFailed}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/** 复制路径的短暂反馈：成功两秒后回到 idle。 */
function useCopyPath(path: string): {
  readonly state: 'idle' | 'copied' | 'failed'
  readonly set: (state: 'idle' | 'copied' | 'failed') => void
} {
  const [state, setState] = React.useState<'idle' | 'copied' | 'failed'>('idle')

  React.useEffect(() => {
    if (state !== 'copied') return undefined
    const timer = window.setTimeout(() => {
      setState('idle')
    }, 2000)
    return () => {
      window.clearTimeout(timer)
    }
  }, [state, path])

  return { state, set: setState }
}

const COMPACT_BUTTON_STYLE: CSSProperties = {
  ...SKILL_BADGE_BUTTON_STYLE,
  color: COLORS.secondary,
  gap: 3,
  padding: '0 7px 0 5px',
}

const DISABLED_LOOK_STYLE: CSSProperties = {
  opacity: 0.5,
  cursor: 'not-allowed',
}

const RESULT_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '7px 10px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  background: COLORS.surface,
  color: COLORS.text,
  fontSize: 12,
}

const RESULT_COMPACT_STYLE: CSSProperties = {
  ...RESULT_STYLE,
  margin: '0 12px 6px',
}

const NOTICE_STYLE: CSSProperties = {
  color: COLORS.success,
}

const LINE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  flexWrap: 'wrap',
  gap: 6,
  minWidth: 0,
}

const LABEL_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  flex: 'none',
}

const CODE_STYLE: CSSProperties = {
  overflowWrap: 'anywhere',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
}

const LINK_STYLE: CSSProperties = {
  color: COLORS.accent,
  overflowWrap: 'anywhere',
}

const COPY_BUTTON_STYLE: CSSProperties = {
  ...BUTTON_STYLE,
  padding: '0 6px',
  fontSize: 11,
  lineHeight: '18px',
}

const COPY_ERROR_STYLE: CSSProperties = {
  color: COLORS.warn,
}

const ERROR_COMPACT_STYLE: CSSProperties = {
  margin: '0 12px 6px',
}

const ERROR_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
  padding: '6px 10px',
  border: `1px solid ${COLORS.error}`,
  borderRadius: 8,
  color: COLORS.error,
  fontSize: 12,
  overflowWrap: 'anywhere',
}
