/**
 * 工单列表视图。只依赖注入的面板客户端与提示词复制端口，不直接接触宿主，
 * 因此 Vitest + jsdom 就能测统计、过滤、排序、加载与错误状态。
 *
 * 点击工单行只打开详情，不复制提示词；复制由操作栏的明确按钮与详情视图触发。
 */
import * as React from 'react'

import type {
  ErrorCode,
  SnapshotSource,
  TicketSnapshot,
  WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import type { MessageId } from '../protocol/i18n.ts'
import { backendLabel } from './backend-label.ts'
import { ErrorBanner } from './error-banner.tsx'
import { hierarchyAvailability, type HierarchyAvailability } from './hierarchy-text.ts'
import { HierarchyNotice } from './hierarchy-notice.tsx'
import { useMessages } from './i18n.ts'
import { FolderIcon, PeopleIcon, PlusIcon, RefreshIcon } from './icons.tsx'
import type { PromptCopy } from './injection.ts'
import { LayoutToggle } from './layout-toggle.tsx'
import { newBugPrompt, newFeaturePrompt } from './prompts.ts'
import { PromptCopyArea } from './prompt-copy.tsx'
import { formatRelativeTime } from './relative-time.ts'
import type { PanelClient } from './transport.ts'
import { useNow } from './snapshot-age.ts'
import { snapshotRefreshNotice, type SnapshotRequestState } from './snapshot-request.ts'
import { useTicketActions } from './ticket-actions.ts'
import { TicketList } from './ticket-list.tsx'
import {
  buildTicketRows,
  expandAncestors,
  type TicketLayout,
  type TicketTreeRow,
} from './ticket-tree.ts'
import {
  AGE_STYLE,
  BACKEND_BADGE_STYLE,
  BUG_ACTION_STYLE,
  BUTTON_STYLE,
  CHIP_ACTIVE_STYLE,
  COLORS,
  EMPTY_STYLE,
  FEATURE_ACTION_STYLE,
  FILTERS,
  FILTER_CHIP_STYLE,
  FILTER_SEGMENTED_STYLE,
  HEADER_STYLE,
  LOADED_ROW_STYLE,
  LOADED_STYLE,
  LOADED_TRAILING_STYLE,
  REFRESH_BUTTON_STYLE,
  REPO_CHIP_STYLE,
  REPO_HOST_STYLE,
  REPO_NAME_STYLE,
  SORT_OPTIONS,
  PEOPLE_CHIP_ACTIVE_STYLE,
  PEOPLE_CHIP_STYLE,
  PEOPLE_CLEAR_STYLE,
  PEOPLE_COUNT_ACTIVE_STYLE,
  PEOPLE_COUNT_STYLE,
  PEOPLE_ROW_STYLE,
  PEOPLE_VIEWER_STYLE,
  SORT_DIRECTION_STYLE,
  SORT_GROUP_STYLE,
  SORT_SELECT_STYLE,
  TOOLBAR_FALLBACK_STYLE,
  TOOLBAR_STYLE,
} from './task-panel-styles.ts'
import {
  countByFilter,
  countTickets,
  viewTickets,
  type PeopleCounts,
  type PeopleFilter,
  type PersonFilterKey,
  type SortDirection,
  type TicketFilter,
  type TicketSortKey,
} from './ticket-view.ts'
import { RowDisplayControl } from './row-display-control.tsx'
import { useViewPreference, type RowField, type RowFields } from './view-preference.ts'

/** 全量刷新是次要动作：描边按钮，和刷新按钮并排但不同层级。 */
const SECONDARY_BUTTON_STYLE: React.CSSProperties = {
  ...BUTTON_STYLE,
  padding: '2px 6px',
  fontSize: 12,
  color: COLORS.secondary,
}

/** 刷新失败原因：贴在数据时间旁边，说明数据没更新，但不盖住列表。 */
const REFRESH_ERROR_STYLE: React.CSSProperties = {
  color: COLORS.error,
  fontSize: 12,
  maxWidth: 160,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** 列表底部的翻页行：贴在滚动区下沿，列表再长也点得到。 */
const LOAD_MORE_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  padding: '6px 12px 10px',
  flex: 'none',
}

/** 工单列表视图依赖。 */
export interface TicketsViewProps {
  readonly client: PanelClient
  readonly workspaceRoot: string | undefined
  /** 面板的提示词复制端口。 */
  readonly copy: PromptCopy
  readonly now?: (() => number) | undefined
  /** 面板层取到的快照：切视图、进详情都不重新拉，回到列表时筛选与数据原样保留。 */
  readonly request: SnapshotRequestState
  /** 环境问题导致列表失败时，跳到环境检查视图并带上错误码定位后端。 */
  readonly onOpenEnvCheck: (code: ErrorCode) => void
  /** 点击工单行：打开这张票的详情，不做提示词复制。 */
  readonly onOpenTicket: (ticket: TicketSnapshot) => void
  /** 从概览跳过来时要定位的票；只高亮，不写提示词。 */
  readonly focusRef?: string | null | undefined
  /** 定位完成后清空焦点，避免重新挂载时再次定位。 */
  readonly onFocusHandled?: (() => void) | undefined
}

/** 工单列表视图。 */
export function TicketsView(props: TicketsViewProps): React.ReactElement {
  const t = useMessages()
  const clock = props.now ?? Date.now
  const { snapshot, error, refreshError, phase, refresh, refreshFull, appending, loadMore } =
    props.request
  const { preference, setFilter, toggleSort, togglePerson, clearPeople, setLayout, toggleRowField } =
    useViewPreference(props.workspaceRoot, snapshot)
  const nowValue = useNow(clock)
  const actions = useTicketActions(props.workspaceRoot, props.copy, props.client)

  const tickets = snapshot?.tickets ?? []
  const chipCounts = countByFilter(countTickets(tickets))
  const view = viewTickets(tickets, {
    filter: preference.filter,
    sortKey: preference.sortKey,
    direction: preference.direction,
    viewer: snapshot?.viewer ?? null,
    people: preference,
  })
  const visible = view.visible
  const busy = phase === 'loading' || phase === 'refreshing' || appending

  const focusedTicket = useFocusedTicket(
    props.focusRef,
    props.onFocusHandled,
    props.workspaceRoot,
  )
  const focused = focusedTicket.ref
  const hierarchy: HierarchyAvailability =
    snapshot === null
      ? { available: false, hint: t('tickets.layout.unavailable') }
      : hierarchyAvailability(snapshot.backend, snapshot.hierarchy, t)
  // 只有快照声明了父子能力时父子布局才生效；偏好本身保留，换回有能力的后端会自动恢复。
  const layout: TicketLayout =
    preference.layout === 'hierarchy' && hierarchy.available ? 'hierarchy' : 'flat'
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set())
  // 每个定位请求只展开一次祖先链：之后刷新 / 加载更多不能取消用户刚做的折叠。
  const expandedFocusToken = React.useRef(0)

  // 折叠是会话内状态：换工作区时清空，避免把上一个仓库的父票引用带过来。
  React.useEffect(() => {
    setCollapsed(new Set())
  }, [props.workspaceRoot])

  // 从概览定位一张被折叠的票时，自动展开它的祖先链；展开状态保留。
  React.useEffect(() => {
    if (focusedTicket.ref === null || expandedFocusToken.current === focusedTicket.token) return
    // 票还没进入当前可见集合（例如首屏未到）：等下一次快照再展开。
    if (!tickets.some((ticket) => ticket.ref === focusedTicket.ref)) return
    expandedFocusToken.current = focusedTicket.token
    setCollapsed((current) => expandAncestors(tickets, current, focusedTicket.ref))
  }, [focusedTicket, tickets])

  const rows = buildTicketRows(visible, layout, collapsed)
  const toggleCollapse = (ref: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(ref)) next.delete(ref)
      else next.add(ref)
      return next
    })
  }
  const newFeature = (): void => {
    void actions.copyPrompt((style) => newFeaturePrompt(t, style))
  }
  const newBug = (): void => {
    void actions.copyPrompt((style) => newBugPrompt(t, style))
  }

  return (
    <div
      data-testid="tickets-view"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <Header
        snapshot={snapshot}
        now={nowValue}
        loading={phase === 'loading'}
        busy={busy}
        notice={snapshotRefreshNotice(snapshot, refreshError, t)}
        onRefresh={refresh}
        onRefreshFull={refreshFull}
      />
      <Toolbar
        counts={snapshot === null ? null : chipCounts}
        filter={preference.filter}
        sortKey={preference.sortKey}
        direction={preference.direction}
        rowFields={preference}
        assigneesAvailable={snapshot !== null && snapshot.backend !== 'markdown'}
        onFilter={setFilter}
        onSort={toggleSort}
        onToggleRowField={toggleRowField}
        onNewFeature={newFeature}
        onNewBug={newBug}
      />
      {error !== null ? <ErrorBanner error={error} onOpenEnvCheck={props.onOpenEnvCheck} /> : null}
      {snapshot !== null ? (
        <>
          {/* 认不出当前用户时整行不出现：不放永远点不出结果的按钮。 */}
          <PeopleFilterRow
            viewer={snapshot.viewer}
            people={preference}
            counts={view.counts}
            onToggle={togglePerson}
            onClear={clearPeople}
          />
          <HierarchyNotice snapshot={snapshot} preference={preference} layout={layout} />
          <TicketRows
            snapshot={snapshot}
            rows={rows}
            layout={layout}
            hierarchy={hierarchy}
            ticketCount={tickets.length}
            appending={appending}
            copied={actions.copied}
            focused={focused}
            now={nowValue}
            rowFields={preference}
            client={props.client}
            workspaceRoot={props.workspaceRoot}
            onOpenEnvCheck={props.onOpenEnvCheck}
            onLoadMore={loadMore}
            onNewFeature={newFeature}
            onNewBug={newBug}
            onPick={props.onOpenTicket}
            onSkillAction={actions.onSkillAction}
            onToggleCollapse={toggleCollapse}
            onLayout={setLayout}
          />
        </>
      ) : phase === 'loading' ? (
        <div data-testid="loading" style={EMPTY_STYLE}>
          {t('common.loadingTickets')}
        </div>
      ) : null}
      <PromptCopyArea state={actions.copyState} onDismiss={actions.dismiss} />
    </div>
  )
}

/**
 * 从概览跳过来时要定位的票：只高亮，不复制提示词——概览是只读视图。
 *
 * `token` 每次外部定位请求递增：同一张票再次从概览点进来也算一次新请求，
 * 祖先链会重新展开；刷新 / 加载更多不会改动令牌，折叠状态因此得以保留。
 * @param focusRef - 面板传下来的待定位引用。
 * @param onFocusHandled - 定位完成后的回调，面板据此清空待定位状态。
 * @param workspaceRoot - 当前工作区；换工作区时定位失效。
 * @returns 当前要定位的引用与请求令牌。
 */
function useFocusedTicket(
  focusRef: string | null | undefined,
  onFocusHandled: (() => void) | undefined,
  workspaceRoot: string | undefined,
): { readonly ref: string | null; readonly token: number } {
  const [focused, setFocused] = React.useState<{
    readonly ref: string | null
    readonly token: number
  }>({ ref: null, token: 0 })
  const token = React.useRef(0)

  React.useEffect(() => {
    if (focusRef === null || focusRef === undefined) return
    token.current += 1
    setFocused({ ref: focusRef, token: token.current })
    onFocusHandled?.()
  }, [focusRef, onFocusHandled])

  // 换工作区时清掉定位；首次挂载不清，刚跳过来的定位要留住。
  const previousRoot = React.useRef(workspaceRoot)
  React.useEffect(() => {
    if (previousRoot.current === workspaceRoot) return
    previousRoot.current = workspaceRoot
    setFocused((current) => (current.ref === null ? current : { ref: null, token: token.current }))
  }, [workspaceRoot])

  return focused
}

function TicketRows(props: {
  readonly snapshot: WorkspaceSnapshot
  readonly rows: readonly TicketTreeRow[]
  readonly layout: TicketLayout
  readonly hierarchy: HierarchyAvailability
  readonly ticketCount: number
  readonly appending: boolean
  readonly copied: string | null
  readonly focused: string | null
  readonly now: number
  readonly rowFields: RowFields
  readonly client: PanelClient
  readonly workspaceRoot: string | undefined
  readonly onOpenEnvCheck: (code: ErrorCode) => void
  readonly onLoadMore: () => void
  readonly onNewFeature: () => void
  readonly onNewBug: () => void
  readonly onPick: (ticket: TicketSnapshot) => void
  readonly onSkillAction: (ticket: TicketSnapshot) => void
  readonly onToggleCollapse: (ref: string) => void
  readonly onLayout: (layout: TicketLayout) => void
}): React.ReactElement {
  const t = useMessages()
  const remaining = Math.max(0, props.snapshot.total - props.snapshot.loaded)
  return (
    <>
      <div style={LOADED_ROW_STYLE}>
        <span data-testid="loaded-total" style={LOADED_STYLE}>
          {t('tickets.loadedTotal', {
            loaded: props.snapshot.loaded,
            total: props.snapshot.total,
          })}
        </span>
        <div style={LOADED_TRAILING_STYLE}>
          <IntakeActions
            compact
            onNewFeature={props.onNewFeature}
            onNewBug={props.onNewBug}
          />
          <LayoutToggle
            layout={props.layout}
            hierarchy={props.hierarchy}
            onLayout={props.onLayout}
          />
        </div>
      </div>
      <TicketList
        rows={props.rows}
        layout={props.layout}
        emptyText={
          props.ticketCount === 0 ? t('tickets.emptyRepo') : t('tickets.emptyFiltered')
        }
        copied={props.copied}
        focused={props.focused}
        now={props.now}
        rowFields={props.rowFields}
        backend={props.snapshot.backend}
        workspaceRoot={props.workspaceRoot}
        client={props.client}
        onOpenEnvCheck={props.onOpenEnvCheck}
        onPick={props.onPick}
        onSkillAction={props.onSkillAction}
        onToggleCollapse={props.onToggleCollapse}
      />
      {/* 翻页入口贴在列表下沿：滚到列表底部就能看到，不随内容滚走。 */}
      {props.snapshot.hasMore ? (
        <div style={LOAD_MORE_ROW_STYLE}>
          <button
            type="button"
            data-testid="load-more"
            data-hover="soft"
            disabled={props.appending}
            title={
              remaining > 0
                ? t('tickets.loadMoreRemaining', { count: remaining })
                : t('tickets.loadMoreHint')
            }
            onClick={props.onLoadMore}
            style={{ ...SECONDARY_BUTTON_STYLE, opacity: props.appending ? 0.6 : 1 }}
          >
            {props.appending ? t('tickets.loadingMore') : t('tickets.loadMore')}
          </button>
        </div>
      ) : null}
    </>
  )
}

/** 数据来源徽标：本地缓存的数据不是实时的，标出来才不会误判。 */
function SourceBadge(props: { readonly source: SnapshotSource }): React.ReactElement {
  const t = useMessages()
  return (
    <span
      data-testid="snapshot-source"
      style={{
        ...BACKEND_BADGE_STYLE,
        color: props.source === 'cache' ? COLORS.warn : COLORS.secondary,
      }}
    >
      {props.source === 'cache' ? t('common.cache') : t('common.live')}
    </span>
  )
}

function Header(props: {
  readonly snapshot: WorkspaceSnapshot | null
  readonly now: number
  readonly loading: boolean
  readonly busy: boolean
  /** 数据旁边的失败原因：有数据时显示在时间旁边，不用整屏横幅盖住列表。 */
  readonly notice: string | null
  readonly onRefresh: () => void
  readonly onRefreshFull: () => void
}): React.ReactElement {
  const t = useMessages()

  return (
    <header style={HEADER_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <div style={REPO_CHIP_STYLE}>
          <FolderIcon />
          <span
            data-testid="repo-name"
            style={REPO_NAME_STYLE}
            {...(props.snapshot === null ? {} : { title: props.snapshot.repository })}
          >
            {props.snapshot?.repository ??
              (props.loading ? t('common.identifyingRepository') : t('common.unknownRepository'))}
          </span>
        </div>
        {props.snapshot === null ? null : (
          <span data-testid="backend-badge" style={BACKEND_BADGE_STYLE}>
            {backendLabel(props.snapshot.backend, t)}
          </span>
        )}
        {/* 数据来源：本地缓存的数据不是实时的，必须让用户一眼看出来。 */}
        {props.snapshot === null ? null : <SourceBadge source={props.snapshot.source} />}
        {/* 自建 Gitea 可能同时登录多个实例，主机名是区分同名仓库的唯一线索。 */}
        {props.snapshot?.backend === 'gitea' && props.snapshot.repositoryHost !== null ? (
          <span
            data-testid="repo-host"
            title={props.snapshot.repositoryHost}
            style={REPO_HOST_STYLE}
          >
            {props.snapshot.repositoryHost}
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
        <span data-testid="snapshot-age" style={AGE_STYLE}>
          {props.snapshot === null
            ? t('common.noSnapshot')
            : formatRelativeTime(props.snapshot.fetchedAt, props.now, t)}
        </span>
        {props.notice === null ? null : (
          <span data-testid="refresh-error" title={props.notice} style={REFRESH_ERROR_STYLE}>
            {props.notice}
          </span>
        )}
        <button
          type="button"
          data-testid="refresh"
          data-hover="soft"
          disabled={props.busy}
          title={t('tickets.refreshTitle')}
          onClick={(event) => {
            if (event.shiftKey) {
              props.onRefreshFull()
              return
            }
            props.onRefresh()
          }}
          style={{ ...REFRESH_BUTTON_STYLE, opacity: props.busy ? 0.6 : 1 }}
        >
          <RefreshIcon />
          {props.busy ? t('common.refreshBusy') : t('common.refresh')}
        </button>
      </div>
    </header>
  )
}

/**
 * 一个入池按钮：点一下把提示词复制到剪贴板。
 * 剪贴板写不进去时复制端口回报 manual，面板自动给出手动复制区，所以按钮从不禁用。
 */
function IntakeAction(props: {
  readonly testId: string
  readonly label: string
  readonly title: string
  readonly ariaLabel: string
  readonly style: React.CSSProperties
  readonly hover: 'primary' | 'secondary'
  readonly onCopy: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={props.testId}
      data-hover={props.hover}
      title={props.title}
      aria-label={props.ariaLabel}
      onClick={props.onCopy}
      style={{ ...props.style, flex: 'none' }}
    >
      <PlusIcon />
      {props.label}
    </button>
  )
}

/** 新建需求与 bug：无快照时留在工具栏，有快照时进列表头，两处共用一组按钮。 */
function IntakeActions(props: {
  readonly onNewFeature: () => void
  readonly onNewBug: () => void
  /** 列表头里与布局开关同高，不把「已加载」行撑高。 */
  readonly compact?: boolean
}): React.ReactElement {
  const t = useMessages()
  const compact = props.compact === true
  return (
    <div style={INTAKE_ACTIONS_STYLE}>
      <IntakeAction
        testId="new-feature"
        label={t('tickets.newFeature')}
        title={t('tickets.newFeatureHint')}
        ariaLabel={t('tickets.newFeatureLabel')}
        style={compact ? { ...FEATURE_ACTION_STYLE, ...COMPACT_INTAKE_STYLE } : FEATURE_ACTION_STYLE}
        hover="primary"
        onCopy={props.onNewFeature}
      />
      <IntakeAction
        testId="new-bug"
        label={t('tickets.newBug')}
        title={t('tickets.newBugHint')}
        ariaLabel={t('tickets.newBugLabel')}
        style={compact ? { ...BUG_ACTION_STYLE, ...COMPACT_INTAKE_STYLE } : BUG_ACTION_STYLE}
        hover="secondary"
        onCopy={props.onNewBug}
      />
    </div>
  )
}

/** 紧凑版只收竖直内边距：高度对齐布局开关，文字与图标尺寸不变。 */
const COMPACT_INTAKE_STYLE: React.CSSProperties = {
  padding: '2px 8px 2px 6px',
}

const INTAKE_ACTIONS_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 'none',
}

function Toolbar(props: {
  readonly counts: Readonly<Record<TicketFilter, number>> | null
  readonly filter: TicketFilter
  readonly sortKey: TicketSortKey
  readonly direction: SortDirection
  readonly rowFields: RowFields
  /** 当前后端是否有分配人概念；本地 Markdown 不出现分配人开关。 */
  readonly assigneesAvailable: boolean
  readonly onFilter: (filter: TicketFilter) => void
  readonly onSort: (key: TicketSortKey) => void
  readonly onToggleRowField: (field: RowField) => void
  readonly onNewFeature: () => void
  readonly onNewBug: () => void
}): React.ReactElement {
  const t = useMessages()
  const ascending = props.direction === 'asc'
  const counts = props.counts

  return (
    <div style={TOOLBAR_STYLE}>
      {counts === null ? null : (
        <div
          role="group"
          aria-label={t('tickets.filterGroup')}
          data-scroll-x=""
          style={FILTER_SEGMENTED_STYLE}
        >
          {FILTERS.map((item) => (
            <Chip
              key={item}
              testId={`filter-${item}`}
              label={t(FILTER_LABELS[item])}
              count={counts[item]}
              active={props.filter === item}
              onClick={() => {
                props.onFilter(item)
              }}
            />
          ))}
        </div>
      )}
      {counts === null ? (
        <div style={TOOLBAR_FALLBACK_STYLE}>
          <IntakeActions onNewFeature={props.onNewFeature} onNewBug={props.onNewBug} />
        </div>
      ) : (
        <div role="group" aria-label={t('tickets.sortGroup')} style={SORT_GROUP_STYLE}>
          <select
            data-testid="sort-key"
            aria-label={t('tickets.sortField')}
            value={props.sortKey}
            onChange={(event) => {
              // 换字段时用该字段的默认方向；同字段不会触发 change。
              props.onSort(event.target.value as TicketSortKey)
            }}
            style={SORT_SELECT_STYLE}
          >
            {SORT_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {t(SORT_LABELS[item])}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="sort-direction"
            data-hover="soft"
            title={ascending ? t('tickets.sortAscHint') : t('tickets.sortDescHint')}
            aria-label={ascending ? t('tickets.sortAscHint') : t('tickets.sortDescHint')}
            onClick={() => {
              // 对当前字段再切一次 = 翻转方向。
              props.onSort(props.sortKey)
            }}
            style={SORT_DIRECTION_STYLE}
          >
            {ascending ? '↑' : '↓'}
          </button>
        </div>
      )}
      <RowDisplayControl
        fields={props.rowFields}
        assigneesAvailable={props.assigneesAvailable}
        onToggleField={props.onToggleRowField}
      />
    </div>
  )
}

const FILTER_LABELS: Readonly<Record<TicketFilter, MessageId>> = {
  all: 'tickets.filter.all',
  open: 'tickets.filter.open',
  closed: 'tickets.filter.closed',
  blocked: 'tickets.filter.blocked',
  ready: 'tickets.filter.ready',
}

const SORT_LABELS: Readonly<Record<TicketSortKey, MessageId>> = {
  status: 'tickets.sort.status',
  updated: 'tickets.sort.updated',
  created: 'tickets.sort.created',
  number: 'tickets.sort.number',
  title: 'tickets.sort.title',
}

/** 计数沿用统计条的字重与等宽数字，颜色跟随 chip 的选中态。 */
const CHIP_COUNT_STYLE: React.CSSProperties = {
  color: COLORS.text,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
}

function Chip(props: {
  readonly testId: string
  readonly label: string
  readonly count: number
  readonly active: boolean
  readonly onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={props.testId}
      aria-pressed={props.active}
      data-hover="soft"
      onClick={props.onClick}
      style={{ ...FILTER_CHIP_STYLE, ...(props.active ? CHIP_ACTIVE_STYLE : undefined) }}
    >
      {props.label}
      {' '}
      <span style={CHIP_COUNT_STYLE}>{props.count}</span>
    </button>
  )
}

/**
 * 人员筛选行：两个独立的人员开关、可选的「清除」与行尾的当前身份。
 * 只在知道当前用户时渲染；整行是一个带名称的按钮组。
 */
export function PeopleFilterRow(props: {
  readonly viewer: string | null
  readonly people: PeopleFilter
  readonly counts: PeopleCounts
  readonly onToggle: (key: PersonFilterKey) => void
  readonly onClear: () => void
}): React.ReactElement | null {
  const viewer = props.viewer
  // 认不出当前用户时整行不出现：不放永远点不出结果的按钮。
  if (viewer === null) return null
  const t = useMessages()
  const anyActive = props.people.assignedToMe || props.people.createdByMe
  const viewerHint = t('tickets.people.viewerHint', { login: viewer })

  return (
    <div
      role="group"
      aria-label={t('tickets.people.group')}
      data-testid="people-filter"
      style={PEOPLE_ROW_STYLE}
    >
      <span aria-hidden="true" style={{ color: COLORS.tertiary, display: 'inline-flex' }}>
        <PeopleIcon />
      </span>
      <PersonChip
        testId="people-assigned"
        label={t('tickets.people.assigned')}
        title={t('tickets.people.assignedHint')}
        count={props.counts.assignedToMe}
        active={props.people.assignedToMe}
        onClick={() => {
          props.onToggle('assignedToMe')
        }}
      />
      <PersonChip
        testId="people-created"
        label={t('tickets.people.created')}
        title={t('tickets.people.createdHint')}
        count={props.counts.createdByMe}
        active={props.people.createdByMe}
        onClick={() => {
          props.onToggle('createdByMe')
        }}
      />
      {anyActive ? (
        <button
          type="button"
          data-testid="people-clear"
          data-hover="link"
          onClick={props.onClear}
          style={PEOPLE_CLEAR_STYLE}
        >
          {t('tickets.people.clear')}
        </button>
      ) : null}
      <span data-testid="people-viewer" title={viewerHint} style={PEOPLE_VIEWER_STYLE}>
        {t('tickets.people.viewer', { login: viewer })}
      </span>
    </div>
  )
}

/**
 * 一个人员开关：文字与计数都在按钮内容里，读屏能读出「分配给我 3」；
 * 选中态同时用描边、底色与字重表达，不只靠颜色。
 */
function PersonChip(props: {
  readonly testId: string
  readonly label: string
  readonly title: string
  readonly count: number
  readonly active: boolean
  readonly onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={props.testId}
      data-hover="person"
      aria-pressed={props.active}
      title={props.title}
      onClick={props.onClick}
      style={{ ...PEOPLE_CHIP_STYLE, ...(props.active ? PEOPLE_CHIP_ACTIVE_STYLE : undefined) }}
    >
      {props.label}
      <span
        style={{
          ...PEOPLE_COUNT_STYLE,
          ...(props.active ? PEOPLE_COUNT_ACTIVE_STYLE : undefined),
        }}
      >
        {props.count}
      </span>
    </button>
  )
}
