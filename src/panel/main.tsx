/**
 * 面板入口：把 React 应用挂到 `#root`，并在启动时接上宿主事件。
 *
 * 工作区根目录由 worker 解析：面板平时传空串，让 worker 自己认领；
 * 认领不到时 worker 推 `workspace.candidates`，面板据此让用户挑一个。
 * 用户挑中的路径会作为 `workspaceRoot` 带回给 worker。
 *
 * 宿主事件在模块加载时就订阅：React 的副作用先子后父，若等到挂载后再订阅，
 * 子组件发出的第一个请求可能早于订阅，候选事件会被漏掉。
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'

import {
  panelCapabilityDiagnostics,
  probePanelCapabilities,
  type PanelCapabilityProbe,
} from './capabilities.ts'
import { readFrame } from './host.ts'
import { promptCopy } from './injection.ts'
import {
  createPanelClient,
  parseWorkspaceCandidates,
  type PanelClient,
  type WorkspaceCandidate,
} from './transport.ts'
import { COLORS } from './task-panel-styles.ts'
import { TaskPanel } from './task-panel.tsx'

/** 宿主事件的最新状态。 */
interface HostState {
  /** worker 推来的工作区候选；null 表示没有待选的工作区。 */
  readonly candidates: readonly WorkspaceCandidate[] | null
  /** 当前用的工作区根目录；空串表示让 worker 自己认领。 */
  readonly workspaceRoot: string
  /** 外部刷新的计数：变了就让视图重新读一次快照。 */
  readonly refreshToken: number
  /** 工作区切换的计数：变了就复位面板。 */
  readonly epoch: number
}

let hostState: HostState = {
  candidates: null,
  workspaceRoot: '',
  refreshToken: 0,
  epoch: 0,
}
const listeners = new Set<() => void>()

function updateHostState(patch: Partial<HostState>): void {
  hostState = { ...hostState, ...patch }
  for (const listener of listeners) listener()
}

function subscribeHost(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getHostState(): HostState {
  return hostState
}

/** 已经排过一次重试；避免候选事件反复触发把请求打成一串。 */
let retryScheduled = false

/**
 * 排一次自动重试。
 *
 * 候选到达说明 worker 认领不到工作区；焦点稳定后它可能自己就能认领，
 * 所以隔一拍再读一次快照，认领得上就直接进列表。
 */
function scheduleRetry(): void {
  if (retryScheduled) return
  retryScheduled = true
  setTimeout(() => {
    retryScheduled = false
    updateHostState({ refreshToken: hostState.refreshToken + 1 })
  }, 1500)
}

/**
 * 订阅事件：worker 推来的候选与刷新走插件桥，宿主的工作区切换走宿主事件。
 */
function subscribeHostEvents(): void {
  const frame = readFrame()
  if (frame === undefined) return
  frame.plugin.on('workspace.candidates', (payload) => {
    updateHostState({ candidates: parseWorkspaceCandidates(payload) })
    scheduleRetry()
  })
  frame.plugin.on('snapshot.refreshed', () => {
    updateHostState({ refreshToken: hostState.refreshToken + 1 })
  })
  frame.on('workspace.changed', () => {
    // 换工作区：已选的路径作废，让 worker 重新认领，详情随之复位。
    updateHostState({
      candidates: null,
      workspaceRoot: '',
      refreshToken: hostState.refreshToken + 1,
      epoch: hostState.epoch + 1,
    })
  })
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

const PICKER_PATH_STYLE: React.CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 11,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '100%',
}

/**
 * 面板应用。
 * @param props - 面板客户端。
 * @returns 候选选择区与面板本体。
 */
function App(props: { readonly client: PanelClient }): React.ReactElement {
  const host = React.useSyncExternalStore(subscribeHost, getHostState)
  const [probe, setProbe] = React.useState<PanelCapabilityProbe | null>(null)
  const [workerReachable, setWorkerReachable] = React.useState(false)

  // 剪贴板可写性要读一次权限状态；读到之前不把面板能力算成可用或不可用。
  React.useEffect(() => {
    let active = true
    void probePanelCapabilities().then((next) => {
      if (active) setProbe(next)
    })
    return () => {
      active = false
    }
  }, [])

  // 探测 worker：能完成一次请求就算可达（即使这次请求本身失败）。
  React.useEffect(() => {
    let active = true
    void props.client.cache('').then(
      () => {
        if (active) setWorkerReachable(true)
      },
      () => {
        if (active) setWorkerReachable(false)
      },
    )
    return () => {
      active = false
    }
  }, [props.client])

  const capabilities = React.useMemo(
    () => (probe === null ? [] : panelCapabilityDiagnostics(probe, workerReachable)),
    [probe, workerReachable],
  )

  const candidates = host.candidates

  return (
    <div
      data-mattwf-panel=""
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      {candidates === null || candidates.length === 0 ? null : (
        <WorkspacePicker
          candidates={candidates}
          onPick={(path) => {
            updateHostState({ candidates: null, workspaceRoot: path })
          }}
        />
      )}
      <TaskPanel
        key={`${host.workspaceRoot}:${String(host.epoch)}`}
        client={props.client}
        workspaceRoot={host.workspaceRoot}
        copy={promptCopy}
        refreshToken={host.refreshToken}
        clientCapabilities={() => capabilities}
      />
    </div>
  )
}

/** 候选列表：worker 认领不到工作区时，让用户挑一个仓库目录。 */
function WorkspacePicker(props: {
  readonly candidates: readonly WorkspaceCandidate[]
  readonly onPick: (path: string) => void
}): React.ReactElement {
  return (
    <div data-testid="workspace-picker" style={PICKER_STYLE}>
      <span style={PICKER_TITLE_STYLE}>认不到当前工作区，选一个仓库目录：</span>
      {props.candidates.map((candidate) => (
        <button
          key={candidate.id}
          type="button"
          data-testid="workspace-candidate"
          data-hover="soft"
          onClick={() => {
            props.onPick(candidate.path)
          }}
          style={PICKER_BUTTON_STYLE}
        >
          <span>
            {candidate.project.length > 0 ? `${candidate.project} · ` : ''}
            {candidate.name}
            {candidate.branch.length > 0 ? ` · ${candidate.branch}` : ''}
          </span>
          <span style={PICKER_PATH_STYLE}>{candidate.path}</span>
        </button>
      ))}
    </div>
  )
}

/** 主题样式表：宿主可能禁止外链样式，缺了也有内联兜底色。 */
function injectTheme(): void {
  if (typeof document === 'undefined') return
  const existing = document.querySelector('link[data-mattwf-theme]')
  if (existing !== null) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = './theme.css'
  link.dataset['mattwfTheme'] = 'true'
  document.head.append(link)
}

const container = document.getElementById('root')
if (container === null) {
  throw new Error('面板缺少 #root 挂载点')
}

subscribeHostEvents()
injectTheme()
const client = createPanelClient()
createRoot(container).render(<App client={client} />)