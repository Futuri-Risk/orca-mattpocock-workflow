/**
 * 工单列表。每行左边是编号与标题，标题下一行是状态与分类；右边是技能按钮，
 * 不可开工时换成原因徽标。点击整行打开这张票的详情，不复制提示词；复制只走技能按钮。
 */
import * as React from 'react'

import type { BackendKind } from '../protocol/backend.ts'
import type { MessageId } from '../protocol/i18n.ts'
import { TRIAGE_LABELS } from '../protocol/labels.ts'
import type {
  ErrorCode,
  TicketAuthor,
  TicketSnapshot,
  TicketStatus,
} from '../protocol/tracker.ts'
import { authorName, authorTitle } from './author-text.ts'
import { useMessages } from './i18n.ts'
import { formatRelativeTime } from './relative-time.ts'
import { SkillActionBadge } from './skill-action-badge.tsx'
import type { PanelClient } from './transport.ts'
import {
  CARD_ACTION_BADGE_STYLE,
  CARD_FOCUSED_STYLE,
  CARD_ROW_STYLE,
  CARD_STYLE,
  CARD_TITLE_STYLE,
  CATEGORY_BADGES,
  EMPTY_STYLE,
  LIST_STYLE,
  NUMBER_BADGE_STYLE,
  STATUS_BADGES,
  STATUS_DOT_STYLE,
} from './task-panel-styles.ts'
import {
  AUTHOR_NAME_STYLE,
  CARD_MAIN_STYLE,
  CARD_META_STYLE,
  COLLAPSE_BUTTON_STYLE,
  COLLAPSE_SPACER_STYLE,
  LABEL_BADGE_STYLE,
  PARENT_BADGE_STYLE,
  ROW_AGE_STYLE,
} from './ticket-row-styles.ts'
import { UserAvatar } from './user-avatar.tsx'
import type { TicketLayout, TicketTreeRow } from './ticket-tree.ts'
import {
  WorktreeCreateButton,
  WorktreeOutcome,
  useWorktreeCreate,
  worktreeAvailability,
} from './worktree-action.tsx'

/** 工单列表依赖。 */
export interface TicketListProps {
  /** 渲染行：平铺是每票一行，父子模式带深度、折叠与父级提示。 */
  readonly rows: readonly TicketTreeRow[]
  /** 当前布局；平铺模式不显示任何父子装饰。 */
  readonly layout: TicketLayout
  /** 列表为空时的提示：区分仓库本来没有工单和被筛选条件过滤掉。 */
  readonly emptyText: string
  /** 最近一次复制成功的工单 `ref`。 */
  readonly copied: string | null
  /** 从概览跳过来要定位的工单 `ref`；只高亮，不改其他状态。 */
  readonly focused?: string | null | undefined
  /** 当前时间（毫秒），用于行内的相对创建时间。 */
  readonly now: number
  /** 当前快照的后端：本地 Markdown 不提供建 worktree 入口。 */
  readonly backend: BackendKind
  readonly workspaceRoot: string | undefined
  readonly client: PanelClient
  readonly onOpenEnvCheck: (code: ErrorCode) => void
  readonly onPick: (ticket: TicketSnapshot) => void
  readonly onSkillAction: (ticket: TicketSnapshot) => void
  /** 折叠或展开一张父票的整棵子树。 */
  readonly onToggleCollapse: (ref: string) => void
}

/** 本地 Markdown 路径在卡片里的显示上限；再长就从中间截断。 */
const REF_DISPLAY_LIMIT = 40

/** 分类之外最多显示几个标签；超出的折成 `+N`，窄面板不被撑破。 */
const MAX_EXTRA_LABELS = 3

/**
 * 渲染过滤、排序后的工单。
 * @param props - 工单、复制状态与点击回调。
 * @returns 卡片列表或空状态。
 */
export function TicketList(props: TicketListProps): React.ReactElement {
  if (props.rows.length === 0) {
    return (
      <div data-testid="empty" style={EMPTY_STYLE}>
        {props.emptyText}
      </div>
    )
  }

  // 只有列表里真有可折叠的父票时才给每行留折叠槽位；全是叶子就不留，
  // 否则父子模式下每张卡片左侧都会白空一块。
  const reserveCollapseSlot =
    props.layout === 'hierarchy' && props.rows.some((row) => row.hasChildren)

  return (
    <div role="list" data-testid="ticket-list" style={LIST_STYLE}>
      {props.rows.map((row) => (
        <TicketRow
          key={row.ticket.ref}
          row={row}
          layout={props.layout}
          reserveCollapseSlot={reserveCollapseSlot}
          copied={row.ticket.ref === props.copied && row.ticket.skillAction !== 'none'}
          focused={row.ticket.ref === props.focused}
          now={props.now}
          backend={props.backend}
          workspaceRoot={props.workspaceRoot}
          client={props.client}
          onOpenEnvCheck={props.onOpenEnvCheck}
          onPick={props.onPick}
          onSkillAction={props.onSkillAction}
          onToggleCollapse={props.onToggleCollapse}
        />
      ))}
    </div>
  )
}

/** 每层缩进的像素数；固定且较小，窄侧栏优先。 */
const INDENT_STEP = 12

function TicketRow(props: {
  readonly row: TicketTreeRow
  readonly layout: TicketLayout
  /** 是否在左侧留折叠槽位；列表里没有父票时为 false。 */
  readonly reserveCollapseSlot: boolean
  readonly copied: boolean
  readonly focused: boolean
  readonly now: number
  /** 当前快照的后端：本地 Markdown 不提供建 worktree 入口。 */
  readonly backend: BackendKind
  readonly workspaceRoot: string | undefined
  readonly client: PanelClient
  readonly onOpenEnvCheck: (code: ErrorCode) => void
  readonly onPick: (ticket: TicketSnapshot) => void
  readonly onSkillAction: (ticket: TicketSnapshot) => void
  readonly onToggleCollapse: (ref: string) => void
}): React.ReactElement {
  const { ticket } = props.row
  const t = useMessages()
  const display = refDisplay(ticket)
  const worktree = useWorktreeCreate(props.client, props.workspaceRoot, ticket)
  const availability = worktreeAvailability(ticket, props.backend, props.workspaceRoot, t)
  const hierarchy = props.layout === 'hierarchy'
  const indent = hierarchy ? props.row.depth * INDENT_STEP : 0

  return (
    <div
      role="listitem"
      data-testid="ticket-row-item"
      data-depth={props.row.depth}
      data-parent-outside={hierarchy && props.row.parentOutsideView ? 'true' : undefined}
      style={indent === 0 ? undefined : { paddingLeft: indent }}
    >
      <div
        data-hover="card"
        // 卡片的表面在这一层：空白页边距也算行的一部分。按钮是键盘可达的打开入口，
        // 它的点击会和这里一样冒泡上来，所以只在行容器上挂一次。
        onClick={() => {
          props.onPick(ticket)
        }}
        style={{ ...CARD_ROW_STYLE, ...(props.focused ? CARD_FOCUSED_STYLE : undefined) }}
      >
        {props.reserveCollapseSlot ? (
          <div style={CARD_MAIN_STYLE}>
            <CollapseControl
              row={props.row}
              onToggle={() => {
                props.onToggleCollapse(ticket.ref)
              }}
            />
            <RowButton
              ticket={ticket}
              display={display}
              focused={props.focused}
              now={props.now}
              row={props.row}
              hierarchy={hierarchy}
            />
          </div>
        ) : (
          <RowButton
            ticket={ticket}
            display={display}
            focused={props.focused}
            now={props.now}
            row={props.row}
            hierarchy={hierarchy}
          />
        )}
        <div style={ACTION_COLUMN_STYLE}>
          <SkillActionBadge
            ticket={ticket}
            copied={props.copied}
            onSkillAction={props.onSkillAction}
            style={CARD_ACTION_BADGE_STYLE}
          />
          <WorktreeCreateButton
            availability={availability}
            busy={worktree.busy}
            onClick={worktree.create}
            compact
          />
        </div>
      </div>
      <WorktreeOutcome
        error={worktree.error}
        result={worktree.result}
        onOpenEnvCheck={props.onOpenEnvCheck}
        compact
      />
    </div>
  )
}

/** 行按钮：编号 + 标题与元信息；点击冒泡到卡片打开详情。 */
function RowButton(props: {
  readonly ticket: TicketSnapshot
  readonly display: { readonly text: string; readonly full?: string }
  readonly focused: boolean
  readonly now: number
  readonly row: TicketTreeRow
  readonly hierarchy: boolean
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid="ticket-row"
      data-ref={props.ticket.ref}
      data-focused={props.focused ? 'true' : undefined}
      style={CARD_STYLE}
    >
      <span style={CARD_TITLE_STYLE}>
        <span
          data-testid="ticket-ref"
          style={NUMBER_BADGE_STYLE}
          {...(props.display.full === undefined ? {} : { title: props.display.full })}
        >
          {props.display.text}
        </span>
        {props.ticket.title}
      </span>
      <MetaRow ticket={props.ticket} now={props.now} row={props.row} hierarchy={props.hierarchy} />
    </button>
  )
}

/** 折叠控件：原生按钮，可 Tab 到达并用 Enter / Space 操作。 */
function CollapseControl(props: {
  readonly row: TicketTreeRow
  readonly onToggle: () => void
}): React.ReactElement {
  const t = useMessages()
  if (!props.row.hasChildren) return (
      <span data-testid="ticket-collapse-spacer" aria-hidden="true" style={COLLAPSE_SPACER_STYLE} />
    )

  const label = props.row.expanded ? t('tickets.collapse') : t('tickets.expand')
  return (
    <button
      type="button"
      data-testid="ticket-collapse"
      data-ref={props.row.ticket.ref}
      data-expanded={props.row.expanded ? 'true' : 'false'}
      aria-expanded={props.row.expanded}
      aria-label={label}
      title={label}
      style={COLLAPSE_BUTTON_STYLE}
      onClick={(event) => {
        // 折叠不打开详情：点击只停在这里。
        event.stopPropagation()
        props.onToggle()
      }}
    >
      {props.row.expanded ? '▾' : '▸'}
    </button>
  )
}

/** 右列：技能动作在上，建 worktree 在下；窄面板里不挤压标题。 */
const ACTION_COLUMN_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 4,
  flex: 'none',
}

function MetaRow(props: {
  readonly ticket: TicketSnapshot
  readonly now: number
  readonly row: TicketTreeRow
  readonly hierarchy: boolean
}): React.ReactElement {
  const t = useMessages()
  const { ticket } = props
  const extra = ticket.labels.filter((label) => label !== ticket.category)
  const { shown, hidden } = pickRowLabels(extra, MAX_EXTRA_LABELS)
  const parent = ticket.parent
  const parentDisplay = parent === undefined ? undefined : clipRef(parent)

  return (
    <span style={CARD_META_STYLE}>
      <span style={STATUS_BADGES[ticket.status]}>
        <span style={STATUS_DOT_STYLE} />
        {t(STATUS_LABEL_KEYS[ticket.status])}
      </span>
      {ticket.category === null ? null : (
        <span style={CATEGORY_BADGES[ticket.category]}>{ticket.category}</span>
      )}
      {props.hierarchy && props.row.hasChildren ? (
        <span data-testid="ticket-children" style={LABEL_BADGE_STYLE}>
          {t('tickets.childCount', { count: props.row.descendantCount })}
        </span>
      ) : null}
      {props.hierarchy && props.row.parentOutsideView && parentDisplay !== undefined ? (
        <span
          data-testid="ticket-parent"
          style={PARENT_BADGE_STYLE}
          title={`${parentDisplay.full ?? parentDisplay.text} · ${t('tickets.parentOutsideHint')}`}
        >
          {t('tickets.parentOutside', { parent: parentDisplay.text })}
        </span>
      ) : null}
      {shown.map((label) => (
        <span key={label} data-testid="ticket-label" style={LABEL_BADGE_STYLE}>
          {label}
        </span>
      ))}
      {hidden > 0 ? (
        <span data-testid="ticket-label-more" style={LABEL_BADGE_STYLE}>
          +{String(hidden)}
        </span>
      ) : null}
      {ticket.author === null ? null : (
        <AuthorMeta
          author={ticket.author}
          createdAt={ticket.createdAt}
          updatedAt={ticket.updatedAt}
          now={props.now}
        />
      )}
    </span>
  )
}

/** 创建人区：头像、用户名与相对创建时间；时间沿用面板头部的说法。 */
function AuthorMeta(props: {
  readonly author: TicketAuthor
  readonly createdAt: string
  readonly updatedAt: string
  readonly now: number
}): React.ReactElement {
  const t = useMessages()
  const { author } = props
  const name = authorName(author)
  const full = authorTitle(author, t)
  const age = formatRelativeTime(props.createdAt, props.now, t)

  return (
    <>
      <UserAvatar user={author} role="creator" size={16} testId="ticket-avatar" />
      <span data-testid="ticket-author" title={full} style={AUTHOR_NAME_STYLE}>
        {name}
      </span>
      {age.length === 0 ? null : (
        <span
          data-testid="ticket-age"
          title={t('tickets.ageTitle', {
            created: props.createdAt,
            updated: props.updatedAt,
          })}
          style={ROW_AGE_STYLE}
        >
          {age}
        </span>
      )}
    </>
  )
}

const STATUS_LABEL_KEYS: Readonly<Record<TicketStatus, MessageId>> = {
  ready: 'status.ready',
  blocked: 'status.blocked',
  closed: 'status.closed',
  open: 'status.open',
}

/**
 * 从分类之外的标签里挑出行内要显示的几个：状态标签先占位，其余按后端顺序补到上限。
 * 显示的标签仍按后端返回的顺序排列；上限与 `+N` 的收敛规则不变，只是被折掉的不会是状态标签。
 * @param labels - 分类之外的标签，保持后端返回的顺序。
 * @param limit - 行内最多显示几个标签。
 * @returns 要显示的标签（仍按后端顺序）与折叠掉的个数。
 */
function pickRowLabels(
  labels: readonly string[],
  limit: number,
): { readonly shown: readonly string[]; readonly hidden: number } {
  const isTriageLabel = (label: string): boolean => TRIAGE_LABELS.includes(label)
  const chosen = new Set<number>()
  // 两轮：先给状态标签占位，再用其余标签补齐剩下的位置。
  const fill = (accept: (label: string) => boolean): void => {
    for (const [index, label] of labels.entries()) {
      if (chosen.size >= limit) return
      if (accept(label)) chosen.add(index)
    }
  }
  fill(isTriageLabel)
  fill((label) => !isTriageLabel(label))

  const shown = labels.filter((_, index) => chosen.has(index))
  return { shown, hidden: labels.length - shown.length }
}

function refDisplay(ticket: TicketSnapshot): { readonly text: string; readonly full?: string } {
  if (ticket.number !== null) return { text: `#${String(ticket.number)}` }
  return clipRef(ticket.ref)
}

/** 过长的引用从中间截断，完整值放在 `full` 里供悬停显示。 */
function clipRef(ref: string): { readonly text: string; readonly full?: string } {
  if (ref.length <= REF_DISPLAY_LIMIT) return { text: ref }

  const head = Math.ceil((REF_DISPLAY_LIMIT - 1) / 2)
  const tail = REF_DISPLAY_LIMIT - 1 - head
  return {
    text: `${ref.slice(0, head)}…${ref.slice(ref.length - tail)}`,
    full: ref,
  }
}
