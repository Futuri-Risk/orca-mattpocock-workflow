/**
 * MattWorkflow 右栏面板外壳：在「列表 / 概览 / 工单详情 / 环境检查」与「流程帮助」之间切换。
 * 三个业务视图各自管理自己的请求与状态；帮助视图只是静态流程图。
 * 详情态由当前选中的工单驱动：点击工单行进入详情，返回或 Esc 回到列表；
 * 列表的筛选与排序由视图偏好按工作区记住，重新挂载时原样恢复。
 * 概览只读：从关注清单点进列表只定位那张票，不复制提示词。
 * 切换工作区时详情复位，避免显示上一个仓库的票。
 */
import * as React from 'react'

import type { BackendKind } from '../protocol/backend.ts'
import type { CapabilityDiagnostic } from '../protocol/env-check.ts'
import type { LanguageSetting } from '../protocol/i18n.ts'
import { ERROR_BACKENDS, type ErrorCode, type TicketSnapshot } from '../protocol/tracker.ts'
import { useLocale, useMessages } from './i18n.ts'
import type { PromptCopy } from './injection.ts'
import { EnvCheckView } from './env-check-view.tsx'
import { HelpView } from './help-view.tsx'
import { OverviewView } from './overview-view.tsx'
import type { PanelClient } from './transport.ts'
import {
  COLORS,
  ICON_BUTTON_STYLE,
  PANEL_SHEET,
  PANEL_STYLE,
  VIEW_BAR_STYLE,
  VIEW_TAB_ACTIVE_STYLE,
  VIEW_TAB_STYLE,
  VIEW_TABS_STYLE,
} from './task-panel-styles.ts'
import { TicketDetailView } from './ticket-detail-view.tsx'
import { TicketsView } from './tickets-view.tsx'

/** 面板依赖。 */
export interface TaskPanelProps {
  readonly client: PanelClient
  readonly workspaceRoot: string | undefined
  /** 面板的提示词复制端口。 */
  readonly copy: PromptCopy
  readonly now?: (() => number) | undefined
  /** 外部推送的刷新信号：变了就重新读一次快照。 */
  readonly refreshToken?: number | undefined
  /** 面板侧能力探测结果；省略时环境检查仍能显示 worker 侧的能力。 */
  readonly clientCapabilities?: (() => readonly CapabilityDiagnostic[]) | undefined
}

type View = 'tickets' | 'overview' | 'env' | 'help'

/** 当前打开的详情；保存整张列表快照行，详情头部与列表行共用同一份技能动作。 */
interface OpenTicket {
  /** 详情所属工作区：工作区一变就立即失效，不会用新工作区去读旧票。 */
  readonly workspaceRoot: string
  readonly ticket: TicketSnapshot
}

const NO_CAPABILITIES = (): readonly CapabilityDiagnostic[] => []

/**
 * MattWorkflow 面板的根组件。
 * @param props - 面板客户端、工作区、提示词复制端口与能力读取函数。
 * @returns 视图切换条与当前视图。
 */
export function TaskPanel(props: TaskPanelProps): React.ReactElement {
  const [view, setView] = React.useState<View>('tickets')
  const [focusBackend, setFocusBackend] = React.useState<FocusBackend>(null)
  const [openTicket, setOpenTicket] = React.useState<OpenTicket | null>(null)
  // 从概览跳进列表时要定位的票；列表消费后清空。
  const [focusTicket, setFocusTicket] = React.useState<string | null>(null)
  // 从帮助返回打开前的视图；帮助里再点 tips 不覆盖它。
  const previousView = React.useRef<Exclude<View, 'help'>>('tickets')
  const clientCapabilities = props.clientCapabilities ?? NO_CAPABILITIES

  // 详情只在它所属的工作区里有效；切换工作区后立即回到新仓库的列表。
  const open =
    openTicket !== null && openTicket.workspaceRoot === props.workspaceRoot ? openTicket : null

  const openHelp = (): void => {
    if (view !== 'help') previousView.current = view
    setView('help')
  }

  return (
    <div data-testid="task-panel" data-mattwf-panel="" style={PANEL_STYLE}>
      <style>{PANEL_SHEET}</style>
      <ViewTabs
        view={view}
        onOpenTickets={() => {
          setView('tickets')
          setOpenTicket(null)
        }}
        onOpenOverview={() => {
          setOpenTicket(null)
          setView('overview')
        }}
        onOpenEnvCheck={() => {
          setFocusBackend(null)
          setView('env')
        }}
        onOpenHelp={openHelp}
      />
      <PanelContent
        panel={props}
        view={view}
        open={open}
        focusBackend={focusBackend}
        focusTicket={focusTicket}
        clientCapabilities={clientCapabilities}
        onOpenEnvCheck={(code) => {
          setFocusBackend(ERROR_BACKENDS[code] ?? null)
          setView('env')
        }}
        onOpenTicket={(ticket: TicketSnapshot) => {
          if (props.workspaceRoot === undefined) return
          setOpenTicket({ workspaceRoot: props.workspaceRoot, ticket })
        }}
        onFocusHandled={() => {
          setFocusTicket(null)
        }}
        onCloseDetail={() => {
          setOpenTicket(null)
        }}
        onLocateTicket={(ref: string) => {
          setFocusTicket(ref)
          setOpenTicket(null)
          setView('tickets')
        }}
        onBack={() => {
          setView(previousView.current)
        }}
      />
    </div>
  )
}

/**
 * 当前视图的内容：列表、概览、环境检查或流程帮助。
 * @param props - 面板依赖、当前状态与跳转回调。
 * @returns 当前视图。
 */
function PanelContent(props: {
  readonly panel: TaskPanelProps
  readonly view: View
  readonly open: OpenTicket | null
  readonly focusBackend: FocusBackend
  readonly focusTicket: string | null
  readonly clientCapabilities: () => readonly CapabilityDiagnostic[]
  readonly onOpenEnvCheck: (code: ErrorCode) => void
  readonly onOpenTicket: (ticket: TicketSnapshot) => void
  readonly onFocusHandled: () => void
  readonly onCloseDetail: () => void
  readonly onLocateTicket: (ref: string) => void
  readonly onBack: () => void
}): React.ReactElement {
  const panel = props.panel

  if (props.view === 'tickets') {
    return (
      <TicketsPane
        client={panel.client}
        workspaceRoot={panel.workspaceRoot}
        copy={panel.copy}
        now={panel.now}
        refreshToken={panel.refreshToken}
        open={props.open}
        focusTicket={props.focusTicket}
        onOpenEnvCheck={props.onOpenEnvCheck}
        onOpenTicket={props.onOpenTicket}
        onFocusHandled={props.onFocusHandled}
        onCloseDetail={props.onCloseDetail}
      />
    )
  }

  if (props.view === 'overview') {
    return (
      <OverviewPane
        client={panel.client}
        workspaceRoot={panel.workspaceRoot}
        now={panel.now}
        refreshToken={panel.refreshToken}
        onOpenTicket={props.onLocateTicket}
        onOpenEnvCheck={props.onOpenEnvCheck}
      />
    )
  }

  if (props.view === 'env') {
    return (
      <EnvCheckView
        client={panel.client}
        workspaceRoot={panel.workspaceRoot}
        copy={panel.copy}
        clientCapabilities={props.clientCapabilities}
        focusBackend={props.focusBackend}
      />
    )
  }

  return <HelpView onBack={props.onBack} />
}

/** 从列表错误跳到环境检查时，要落到的后端。 */
type FocusBackend = Exclude<BackendKind, 'markdown'> | null

/**
 * 概览页：只读的一屏总览。
 * @param props - 面板依赖与跳转回调。
 * @returns 概览视图。
 */
function OverviewPane(props: {
  readonly client: PanelClient
  readonly workspaceRoot: string | undefined
  readonly now: (() => number) | undefined
  readonly refreshToken?: number | undefined
  readonly onOpenTicket: (ref: string) => void
  readonly onOpenEnvCheck: (code: ErrorCode) => void
}): React.ReactElement {
  return (
    <OverviewView
      client={props.client}
      workspaceRoot={props.workspaceRoot}
      now={props.now}
      refreshToken={props.refreshToken}
      onOpenTicket={props.onOpenTicket}
      onOpenEnvCheck={props.onOpenEnvCheck}
    />
  )
}

/**
 * 列表页：选中工单时显示详情，否则显示列表。
 * @param props - 面板依赖、当前打开的工单与跳转回调。
 * @returns 详情视图或列表视图。
 */
function TicketsPane(props: {
  readonly client: PanelClient
  readonly workspaceRoot: string | undefined
  /** 面板的提示词复制端口。 */
  readonly copy: PromptCopy
  readonly now: (() => number) | undefined
  /** 外部推送的刷新信号：变了就重新读一次快照。 */
  readonly refreshToken?: number | undefined
  readonly open: OpenTicket | null
  readonly focusTicket: string | null
  readonly onOpenEnvCheck: (code: ErrorCode) => void
  readonly onOpenTicket: (ticket: TicketSnapshot) => void
  readonly onFocusHandled: () => void
  readonly onCloseDetail: () => void
}): React.ReactElement {
  if (props.workspaceRoot !== undefined && props.open !== null) {
    return (
      <TicketDetailView
        client={props.client}
        workspaceRoot={props.workspaceRoot}
        ticket={props.open.ticket}
        copy={props.copy}
        onBack={props.onCloseDetail}
        onOpenEnvCheck={props.onOpenEnvCheck}
      />
    )
  }

  return (
    <TicketsView
      client={props.client}
      workspaceRoot={props.workspaceRoot}
      copy={props.copy}
      now={props.now}
      refreshToken={props.refreshToken}
      focusRef={props.focusTicket}
      onFocusHandled={props.onFocusHandled}
      onOpenEnvCheck={props.onOpenEnvCheck}
      onOpenTicket={props.onOpenTicket}
    />
  )
}

/** 视图切换条：「列表」「概览」「环境检查」与右侧的语言、流程帮助入口。 */
function ViewTabs(props: {
  readonly view: View
  readonly onOpenTickets: () => void
  readonly onOpenOverview: () => void
  readonly onOpenEnvCheck: () => void
  readonly onOpenHelp: () => void
}): React.ReactElement {
  const t = useMessages()

  return (
    <div style={VIEW_BAR_STYLE}>
      <div role="group" aria-label={t('common.viewGroup')} style={VIEW_TABS_STYLE}>
        <ViewChip
          testId="view-tickets"
          label={t('view.tickets')}
          active={props.view === 'tickets'}
          onClick={props.onOpenTickets}
        />
        <ViewChip
          testId="view-overview"
          label={t('view.overview')}
          active={props.view === 'overview'}
          onClick={props.onOpenOverview}
        />
        <ViewChip
          testId="view-env"
          label={t('view.env')}
          active={props.view === 'env'}
          onClick={props.onOpenEnvCheck}
        />
      </div>
      <div style={VIEW_ACTIONS_STYLE}>
        <LanguageSelect />
        <TipsButton label={t('view.help')} onClick={props.onOpenHelp} />
      </div>
    </div>
  )
}

/** 右侧入口组：语言下拉贴着流程帮助图标，窄面板里不抢页签的宽度。 */
const VIEW_ACTIONS_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flex: 'none',
}

/** 语言切换器：写同一个 `language` 设置，改完即时重渲染。 */
function LanguageSelect(): React.ReactElement {
  const t = useMessages()
  const { setting, setSetting, locale } = useLocale()
  const languageName = locale === 'zh-CN' ? t('language.zhCN') : t('language.en')

  return (
    <select
      data-testid="language-select"
      aria-label={t('language.label')}
      title={t('language.effective', { language: languageName })}
      value={setting}
      onChange={(event) => {
        setSetting(event.target.value as LanguageSetting)
      }}
      style={LANGUAGE_SELECT_STYLE}
    >
      <option value="auto">{t('language.autoEffective', { language: languageName })}</option>
      <option value="zh-CN">{t('language.zhCN')}</option>
      <option value="en">{t('language.en')}</option>
    </select>
  )
}

const LANGUAGE_SELECT_STYLE: React.CSSProperties = {
  appearance: 'none',
  border: 'none',
  borderRadius: 6,
  padding: '1px 18px 1px 7px',
  color: COLORS.secondary,
  backgroundColor: 'transparent',
  backgroundImage: `linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)`,
  backgroundPosition: 'right 9px center, right 5px center',
  backgroundSize: '4px 4px, 4px 4px',
  backgroundRepeat: 'no-repeat',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
}

function ViewChip(props: {
  readonly testId: string
  readonly label: string
  readonly active: boolean
  readonly onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={props.testId}
      aria-pressed={props.active}
      onClick={props.onClick}
      data-hover="tab"
      style={{ ...VIEW_TAB_STYLE, ...(props.active ? VIEW_TAB_ACTIVE_STYLE : undefined) }}
    >
      {props.label}
    </button>
  )
}

function TipsButton(props: {
  readonly label: string
  readonly onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid="tips"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      style={ICON_BUTTON_STYLE}
    >
      <TipsIcon />
    </button>
  )
}

function TipsIcon(): React.ReactElement {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1.8a4.1 4.1 0 0 0-2.5 7.4c.3.2.5.5.5.9v.4h4v-.4c0-.4.2-.7.5-.9A4.1 4.1 0 0 0 8 1.8Z" />
      <path d="M6.4 12.6h3.2" />
      <path d="M7.2 14.4h1.6" />
    </svg>
  )
}
