/**
 * 工作区根目录的解析。
 *
 * DSH 侧由界面把 `workspaceRoot` 传进来；Orca 的面板拿不到工作区路径，
 * 只能由 worker 自己解析：读当前工作区的上下文，再在全部工作区里认领一个。
 *
 * 认领规则：先按上下文里的显示名与工作区名精确匹配，再按分支匹配，
 * 唯一命中才采用；命中不了就把候选列表交给面板让用户选。
 */
import { homedir } from 'node:os'

import { isRecord } from '../core/json.ts'
import type { OrcaWorkerApi } from './orca-types.ts'

/** 一个工作区候选。 */
export interface WorkspaceCandidate {
  readonly id: string
  readonly name: string
  /** 工作区在宿主机上的路径；agent 与 git 命令都在这里跑。 */
  readonly path: string
  readonly branch: string | null
  /** 所属仓库名；工作区名是分支别名时用它认领。 */
  readonly project: string | null
  readonly kind: 'worktree' | 'folder'
}

/** 解析结果。 */
export type WorkspaceResolution =
  | {
      readonly status: 'resolved'
      readonly root: string
      readonly candidate: WorkspaceCandidate
    }
  | {
      readonly status: 'ambiguous'
      readonly candidates: readonly WorkspaceCandidate[]
    }
  | {
      readonly status: 'unresolved'
      readonly candidates: readonly WorkspaceCandidate[]
    }

/** 工作区解析器。 */
export interface WorkspaceResolver {
  /** 解析当前工作区的根目录；结果按上下文缓存。 */
  resolve(): Promise<WorkspaceResolution>
  /** 丢弃缓存；工作区切换后调用。 */
  invalidate(): void
}

/**
 * 创建工作区解析器。
 * @param host - 宿主方法调用入口。
 * @returns 解析器。
 */
export function createWorkspaceResolver(host: OrcaWorkerApi['host']): WorkspaceResolver {
  let cached: { readonly key: string; readonly resolution: WorkspaceResolution } | undefined

  return {
    async resolve() {
      const context = await readContext(host)
      if (context === undefined) {
        cached = undefined
        return { status: 'unresolved', candidates: [] }
      }

      const key = `${context.displayName}\u0000${context.branch}`
      if (cached?.key === key) return cached.resolution

      const resolution = await matchWorkspace(host, context)
      cached = { key, resolution }
      return resolution
    },

    invalidate() {
      cached = undefined
    },
  }
}

/** 当前工作区的显示名与分支。 */
interface WorkspaceContext {
  readonly displayName: string
  readonly branch: string
  /** 聚焦工作区的终端标题；标题里常带工作目录，是重名时的线索。 */
  readonly terminalTitles: readonly string[]
}

/** 读当前工作区的上下文；没有聚焦的工作区时是 undefined。 */
async function readContext(host: OrcaWorkerApi['host']): Promise<WorkspaceContext | undefined> {
  try {
    const raw = await host.call('workspace.readContext')
    if (!isRecord(raw)) return undefined
    const displayName = raw['displayName']
    const branch = raw['branch']
    if (typeof displayName !== 'string' || typeof branch !== 'string') return undefined
    const terminals = raw['terminals']
    const terminalTitles = Array.isArray(terminals)
      ? terminals
          .map((terminal) =>
            isRecord(terminal) && typeof terminal['title'] === 'string' ? terminal['title'] : '',
          )
          .filter((title) => title.length > 0)
      : []
    return { displayName, branch, terminalTitles }
  } catch {
    // 宿主读不到上下文时不猜工作区。
    return undefined
  }
}

/**
 * 按显示名认领工作区。
 *
 * 宿主的显示名有时是工作区别名，有时是仓库名；先按工作区名精确匹配，
 * 再退到忽略大小写的匹配，最后按仓库名匹配。
 * @param workspaces - 全部工作区。
 * @param displayName - 宿主的显示名。
 * @returns 命中的工作区。
 */
function matchByName(
  workspaces: readonly WorkspaceCandidate[],
  displayName: string,
): readonly WorkspaceCandidate[] {
  const exact = workspaces.filter((workspace) => workspace.name === displayName)
  if (exact.length > 0) return exact

  const loose = workspaces.filter(
    (workspace) => workspace.name.trim().toLowerCase() === displayName.trim().toLowerCase(),
  )
  if (loose.length > 0) return loose

  return workspaces.filter(
    (workspace) =>
      workspace.project !== null && workspace.project.toLowerCase() === displayName.trim().toLowerCase(),
  )
}

/**
 * 用终端标题里的工作目录认领工作区。
 *
 * 终端标题常带当前目录（`zgray@host: ~/path/to/repo`），是重名工作区时唯一的路径线索。
 * @param workspaces - 候选工作区。
 * @param titles - 聚焦工作区的终端标题。
 * @returns 唯一命中的工作区；没有或多个命中时是 undefined。
 */
function matchByTerminalTitle(
  workspaces: readonly WorkspaceCandidate[],
  titles: readonly string[],
): WorkspaceCandidate | undefined {
  for (const title of titles) {
    const hits = workspaces.filter((workspace) => pathForms(workspace.path).some((form) => title.includes(form)))
    if (hits.length === 1) return hits[0]
  }
  return undefined
}

/**
 * 路径的两种写法：绝对路径与 `~` 缩写。
 *
 * 终端标题里的目录通常写成 `~/Projects/...`，与工作区的绝对路径对不上。
 * @param path - 工作区绝对路径。
 * @returns 可比较的路径写法。
 */
function pathForms(path: string): readonly string[] {
  const home = homedir()
  const forms = [path]
  if (home.length > 0 && path.startsWith(home)) {
    forms.push(`~${path.slice(home.length)}`)
  }
  return forms
}

/** 在全部工作区里认领当前工作区。 */
async function matchWorkspace(
  host: OrcaWorkerApi['host'],
  context: WorkspaceContext,
): Promise<WorkspaceResolution> {
  const workspaces = await listWorkspaces(host)
  if (workspaces.length === 0) return { status: 'unresolved', candidates: [] }

  const byName = matchByName(workspaces, context.displayName)
  if (byName.length === 1) {
    const candidate = byName[0]
    if (candidate !== undefined) return { status: 'resolved', root: candidate.path, candidate }
  }

  const byBranch = workspaces.filter((workspace) => workspace.branch === context.branch)
  // 名字命中多个时用分支再收一次；名字没命中时直接按分支认领。
  const narrowed = byName.length > 1 ? byName.filter((workspace) => byBranch.includes(workspace)) : byBranch
  // 还是多个：终端标题里通常带着工作目录，用它认领。
  if (narrowed.length > 1) {
    const byTerminal = matchByTerminalTitle(narrowed, context.terminalTitles)
    if (byTerminal !== undefined) return { status: 'resolved', root: byTerminal.path, candidate: byTerminal }
  }
  if (narrowed.length === 1) {
    const candidate = narrowed[0]
    if (candidate !== undefined) return { status: 'resolved', root: candidate.path, candidate }
  }

  if (narrowed.length === 0) {
    return { status: 'unresolved', candidates: byName.length > 1 ? byName : byBranch }
  }
  return { status: 'ambiguous', candidates: narrowed }
}

/** 读全部工作区；宿主不支持或读取失败时是空列表。 */
async function listWorkspaces(host: OrcaWorkerApi['host']): Promise<readonly WorkspaceCandidate[]> {
  try {
    const raw = await host.call('workspace.list')
    if (!isRecord(raw)) return []
    const workspaces = raw['workspaces']
    if (!Array.isArray(workspaces)) return []

    const candidates: WorkspaceCandidate[] = []
    for (const entry of workspaces) {
      const candidate = readCandidate(entry)
      if (candidate !== undefined) candidates.push(candidate)
    }
    return candidates
  } catch {
    return []
  }
}

/** 读一个工作区条目；字段不合法时是 undefined。 */
function readCandidate(value: unknown): WorkspaceCandidate | undefined {
  if (!isRecord(value)) return undefined
  const id = value['id']
  const name = value['name']
  const path = value['path']
  const branch = value['branch']
  const project = value['project']
  const kind = value['kind']
  if (typeof id !== 'string' || typeof name !== 'string' || typeof path !== 'string') return undefined
  return {
    id,
    name,
    path,
    branch: typeof branch === 'string' ? branch : null,
    project: typeof project === 'string' ? project : null,
    kind: kind === 'folder' ? 'folder' : 'worktree',
  }
}
