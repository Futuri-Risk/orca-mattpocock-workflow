/**
 * 面板入口：把 React 应用挂到 `#root`，并在启动时接上宿主事件。
 *
 * 工作区根目录由 worker 解析：面板平时传空串，让 worker 自己认领；
 * 认领不到时 worker 推 `workspace.candidates`，面板据此让用户挑一个。
 * 用户挑中的路径会作为 `workspaceRoot` 带回给 worker，worker 把它记在当前
 * 聚焦上下文里，之后的请求与刷新命令都沿用它。
 *
 * 失败不再自动重试：上下文没变时重试不可能成功，只会把工作区请求与日志刷成噪声。
 * 只在 `workspace.changed`（上下文真的变了）或用户主动刷新时重新尝试。
 *
 * 宿主事件在模块加载时就订阅：React 的副作用先子后父，若等到挂载后再订阅，
 * 子组件发出的第一个请求可能早于订阅，候选事件会被漏掉。
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'

import { createAvatarSourceLoader } from './avatar-source.ts'
import {
  panelCapabilityDiagnostics,
  probePanelCapabilities,
  type PanelCapabilityProbe,
} from './capabilities.ts'
import { readFrame } from './host.ts'
import { promptCopy } from './injection.ts'
import {
  createPanelClient,
  parseWorkspaceCandidatesEvent,
  type PanelClient,
  type WorkspaceCandidate,
} from './transport.ts'
import { TaskPanel } from './task-panel.tsx'
import { AvatarSourceProvider } from './user-avatar.tsx'
import { WorkspacePicker } from './workspace-picker.tsx'

/** 宿主事件的最新状态。 */
interface HostState {
  /** worker 推来的工作区候选；null 表示没有待选的工作区。 */
  readonly candidates: readonly WorkspaceCandidate[] | null
  /** 当前用的工作区根目录；空串表示让 worker 自己认领。 */
  readonly workspaceRoot: string
  /** 候选所属的聚焦上下文键；用来判断 `workspace.changed` 后选择是否还该沿用。 */
  readonly contextKey: string
  /** 外部刷新的计数：变了就让视图重新读一次快照。 */
  readonly refreshToken: number
  /** 工作区切换的计数：变了就复位面板。 */
  readonly epoch: number
}

let hostState: HostState = {
  candidates: null,
  workspaceRoot: '',
  contextKey: '',
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

/** 正在同步当前认领结果的序号；只有最后一次响应能落到状态上。 */
let claimSequence = 0

/**
 * 让 worker 重新报一次当前认领结果，并据此更新面板状态。
 *
 * 面板启动、`workspace.changed` 后都走这一条路：候选随响应返回，不依赖推送是否被去重，
 * `workspaceRoot` 也由 worker 给出的路径决定，面板重载后仍能恢复同一个工作区。
 * @param client - 面板客户端。
 */
async function syncWorkspaceClaim(client: PanelClient): Promise<void> {
  const current = claimSequence + 1
  claimSequence = current
  const result = await client.currentWorkspace()
  if (current !== claimSequence || !result.ok) return

  const claim = result.result
  const candidates = claim.candidates.length > 0 ? claim.candidates : null
  const contextChanged =
    hostState.contextKey.length > 0 && claim.contextKey !== hostState.contextKey
  const previousCandidates = (hostState.candidates ?? [])
    .map((candidate) => candidate.id)
    .join('\n')
  const nextCandidates = (candidates ?? []).map((candidate) => candidate.id).join('\n')
  const root = claim.root ?? ''
  const needsReload =
    contextChanged || root !== hostState.workspaceRoot || nextCandidates !== previousCandidates

  updateHostState({
    candidates,
    contextKey: claim.contextKey.length > 0 ? claim.contextKey : hostState.contextKey,
    workspaceRoot: root,
    ...(needsReload
      ? {
          refreshToken: hostState.refreshToken + 1,
          ...(contextChanged ? { epoch: hostState.epoch + 1 } : {}),
        }
      : {}),
  })
}

/**
 * 订阅事件：worker 推来的候选与刷新走插件桥，宿主的工作区切换走宿主事件。
 * @param client - 面板客户端。
 */
function subscribeHostEvents(client: PanelClient): void {
  const frame = readFrame()
  if (frame === undefined) return
  frame.plugin.on('workspace.candidates', (payload) => {
    const event = parseWorkspaceCandidatesEvent(payload)
    // 推来的候选属于某个聚焦上下文；上下文已经换了就不要把旧候选摆回顶部。
    if (
      event.contextKey.length > 0 &&
      hostState.contextKey.length > 0 &&
      event.contextKey !== hostState.contextKey
    ) {
      return
    }
    if (event.contextKey.length > 0) {
      updateHostState({ candidates: event.candidates, contextKey: event.contextKey })
      return
    }
    updateHostState({ candidates: event.candidates })
  })
  frame.plugin.on('snapshot.refreshed', () => {
    updateHostState({ refreshToken: hostState.refreshToken + 1 })
  })
  frame.on('workspace.changed', () => {
    // 事件只当触发：是否换了工作区由 worker 返回的上下文键与路径决定。
    void syncWorkspaceClaim(client)
  })
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
  // 同一张头像在列表、正文、评论与分配人处共享一次请求。
  const loadAvatar = React.useMemo(
    () => createAvatarSourceLoader(props.client),
    [props.client],
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
      <AvatarSourceProvider loader={loadAvatar}>
        <TaskPanel
          key={`${host.workspaceRoot}:${String(host.epoch)}`}
          client={props.client}
          workspaceRoot={host.workspaceRoot}
          copy={promptCopy}
          refreshToken={host.refreshToken}
          clientCapabilities={() => capabilities}
        />
      </AvatarSourceProvider>
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

const client = createPanelClient()
subscribeHostEvents(client)
injectTheme()
void syncWorkspaceClaim(client)
createRoot(container).render(<App client={client} />)
