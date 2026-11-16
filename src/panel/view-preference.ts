/**
 * 视图偏好：按仓库记住筛选、排序键、方向与两个人员开关。
 *
 * 存在 Orca 的插件私有存储里：一个键放一份 JSON 字符串，里面是「偏好键 → 偏好」的映射，
 * 最多保留 50 个条目。存储不可用或数据损坏时静默退回默认视图，不影响面板其余功能。
 *
 * 偏好键与工单缓存的归并规则一致：托管后端按仓库身份（同一仓库的多个 worktree 共用一份），
 * 本地 Markdown 按工作区隔离。升级前按工作区根目录存的条目在读取时作为回退。
 */
import * as React from 'react'

import type { WorkspaceSnapshot } from '../protocol/tracker.ts'
import { readFrame } from './host.ts'
import {
  defaultSortDirection,
  type PeopleFilter,
  type PersonFilterKey,
  type SortDirection,
  type TicketFilter,
  type TicketSortKey,
} from './ticket-view.ts'

/** 面板的一份视图偏好。 */
export interface ViewPreference extends PeopleFilter {
  readonly filter: TicketFilter
  readonly sortKey: TicketSortKey
  readonly direction: SortDirection
}

/** 没有存档时使用的视图：只看未关闭工单，可接的排在前面，不按人员过滤。 */
export const DEFAULT_VIEW: ViewPreference = {
  filter: 'open',
  sortKey: 'status',
  direction: 'asc',
  assignedToMe: false,
  createdByMe: false,
}

/** 插件私有存储的最小形状。 */
export interface PreferenceStore {
  get(key: string): Promise<unknown>
  set(key: string, value: string): Promise<void>
}

/** 存视图偏好的键。 */
const STORAGE_KEY = 'view-preferences'

/** 存档格式版本；结构变了就整体作废。 */
const STORAGE_VERSION = 1

/** 最多保留多少个工作区的偏好；超出的按保存时间淘汰。 */
const MAX_ENTRIES = 50

/** 一个工作区存下来的偏好。 */
interface StoredEntry extends PeopleFilter {
  readonly filter: TicketFilter
  readonly sortKey: TicketSortKey
  readonly direction: SortDirection
  readonly savedAt: number
}

/** 存储里的整体结构。 */
interface PreferenceMap {
  readonly version: number
  readonly entries: Readonly<Record<string, StoredEntry>>
}

// 用穷尽的 Record 而不是数组：联合类型新增成员时这里必须同步，否则类型检查失败。
const FILTERS: Record<TicketFilter, true> = {
  all: true,
  open: true,
  closed: true,
  blocked: true,
  ready: true,
}

const SORT_KEYS: Record<TicketSortKey, true> = {
  updated: true,
  created: true,
  number: true,
  title: true,
  status: true,
}

const DIRECTIONS: Record<SortDirection, true> = { asc: true, desc: true }

// 写入串行化：读改写之间不能被另一个写入插进来，否则会丢条目。
let writeChain: Promise<void> = Promise.resolve()

/** 算偏好键需要的快照字段。 */
export type ViewPreferenceSource = Pick<WorkspaceSnapshot, 'backend' | 'repository' | 'repositoryHost'>

/**
 * 视图偏好的键：托管后端按仓库身份，本地 Markdown 按工作区。
 *
 * 仓库身份与宿主的 `repositoryKey` 同一格式：同一仓库的每个 worktree 算出同一个键。
 * @param snapshot - 当前快照；还没拿到时为 null。
 * @param workspaceRoot - 当前工作区根目录。
 * @returns 偏好键；快照或工作区未知时是 undefined，此时不读不写。
 */
export function viewPreferenceKey(
  snapshot: ViewPreferenceSource | null,
  workspaceRoot: string | undefined,
): string | undefined {
  if (snapshot === null || workspaceRoot === undefined) return undefined
  if (snapshot.backend === 'markdown') return workspaceRoot
  const host = snapshot.repositoryHost === null ? '' : `@${snapshot.repositoryHost}`
  return `${snapshot.backend}${host}/${snapshot.repository}`
}

/**
 * 读取某个偏好键的视图偏好。
 * @param store - 插件私有存储；不可用时传 undefined。
 * @param key - 偏好键（见 {@link viewPreferenceKey}）；未知时不读。
 * @param legacyKey - 升级前按工作区根目录存的键；新键下没有条目时回退到它。
 * @returns 存档合法时返回存档，否则返回默认视图或逐字段回退后的结果。
 */
export async function readViewPreference(
  store: PreferenceStore | undefined,
  key: string | undefined,
  legacyKey?: string,
): Promise<ViewPreference> {
  if (store === undefined || key === undefined) return DEFAULT_VIEW

  const entries = await loadEntries(store)
  const stored = entries[key] ?? (legacyKey === undefined ? undefined : entries[legacyKey])
  if (stored === undefined) return DEFAULT_VIEW

  return {
    filter: isFilter(stored.filter) ? stored.filter : DEFAULT_VIEW.filter,
    sortKey: isSortKey(stored.sortKey) ? stored.sortKey : DEFAULT_VIEW.sortKey,
    direction: isDirection(stored.direction) ? stored.direction : DEFAULT_VIEW.direction,
    // 旧记录没有这两个字段时按 false 读；非法值在 toEntry 里已逐字段回落。
    assignedToMe: stored.assignedToMe,
    createdByMe: stored.createdByMe,
  }
}

/**
 * 写入某个偏好键的视图偏好，并按保存时间淘汰超量的条目。
 * @param store - 插件私有存储；不可用时传 undefined。
 * @param key - 偏好键（见 {@link viewPreferenceKey}）；未知时不写。
 * @param preference - 要保存的偏好。
 * @param now - 保存时间来源。
 */
export function writeViewPreference(
  store: PreferenceStore | undefined,
  key: string | undefined,
  preference: ViewPreference,
  now: () => number = Date.now,
): Promise<void> {
  if (store === undefined || key === undefined) return Promise.resolve()

  const task = writeChain.then(async () => {
    const entries = await loadEntries(store)
    const next: Record<string, StoredEntry> = { ...entries }
    next[key] = {
      filter: preference.filter,
      sortKey: preference.sortKey,
      direction: preference.direction,
      assignedToMe: preference.assignedToMe,
      createdByMe: preference.createdByMe,
      savedAt: now(),
    }
    const map: PreferenceMap = { version: STORAGE_VERSION, entries: evictOldest(next) }
    await store.set(STORAGE_KEY, JSON.stringify(map))
  })

  writeChain = task.catch(() => {
    // 存储写失败不影响面板：偏好只是记不住，别把异常带到界面上。
  })
  return writeChain
}

/** 读出存档里的条目表；结构不对时当作空表。 */
async function loadEntries(store: PreferenceStore): Promise<Record<string, StoredEntry>> {
  let raw: unknown
  try {
    raw = await store.get(STORAGE_KEY)
  } catch {
    return {}
  }
  if (typeof raw !== 'string') return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}
  if (!('version' in parsed) || parsed.version !== STORAGE_VERSION) return {}
  if (!('entries' in parsed) || typeof parsed.entries !== 'object' || parsed.entries === null) {
    return {}
  }

  const entries: Record<string, StoredEntry> = {}
  for (const [key, value] of Object.entries(parsed.entries)) {
    const entry = toEntry(value)
    if (entry !== null) entries[key] = entry
  }
  return entries
}

function toEntry(value: unknown): StoredEntry | null {
  if (typeof value !== 'object' || value === null) return null
  if (!('filter' in value) || !isFilter(value.filter)) return null
  if (!('sortKey' in value) || !isSortKey(value.sortKey)) return null
  if (!('direction' in value) || !isDirection(value.direction)) return null
  const savedAt = 'savedAt' in value && typeof value.savedAt === 'number' ? value.savedAt : 0
  return {
    filter: value.filter,
    sortKey: value.sortKey,
    direction: value.direction,
    assignedToMe: 'assignedToMe' in value && value.assignedToMe === true,
    createdByMe: 'createdByMe' in value && value.createdByMe === true,
    savedAt,
  }
}

/** 只按保存时间淘汰最旧的条目；存档损坏的条目视为最旧。 */
function evictOldest(entries: Record<string, StoredEntry>): Record<string, StoredEntry> {
  const keys = Object.keys(entries)
  if (keys.length <= MAX_ENTRIES) return entries

  const ordered = keys.sort((left, right) => {
    const leftSaved = entries[left]?.savedAt ?? 0
    const rightSaved = entries[right]?.savedAt ?? 0
    return leftSaved - rightSaved
  })

  const kept: Record<string, StoredEntry> = {}
  for (const key of ordered.slice(ordered.length - MAX_ENTRIES)) {
    const entry = entries[key]
    if (entry !== undefined) kept[key] = entry
  }
  return kept
}

function isFilter(value: unknown): value is TicketFilter {
  return typeof value === 'string' && Object.hasOwn(FILTERS, value)
}

function isSortKey(value: unknown): value is TicketSortKey {
  return typeof value === 'string' && Object.hasOwn(SORT_KEYS, value)
}

function isDirection(value: unknown): value is SortDirection {
  return typeof value === 'string' && Object.hasOwn(DIRECTIONS, value)
}

/** 视图偏好的当前值与修改入口。 */
export interface ViewPreferenceControls {
  readonly preference: ViewPreference
  readonly setFilter: (filter: TicketFilter) => void
  readonly toggleSort: (key: TicketSortKey) => void
  /** 切换一个人员开关；另一个开关不受影响。 */
  readonly togglePerson: (key: PersonFilterKey) => void
  /** 一键关掉两个人员开关；状态筛选与排序不动。 */
  readonly clearPeople: () => void
}

/**
 * 读取并按仓库维护视图偏好。存储不可用时全部退回默认视图。
 * @param workspaceRoot - 当前工作区根路径。
 * @param snapshot - 当前快照；偏好键由它的仓库身份决定，还没拿到时用默认视图。
 * @returns 当前偏好与筛选、排序入口。
 */
export function useViewPreference(
  workspaceRoot: string | undefined,
  snapshot: ViewPreferenceSource | null,
): ViewPreferenceControls {
  const store = React.useMemo(resolvePreferenceStore, [])
  // 键是字符串：刷新换了快照对象但仓库没变时，不重新读存档。
  const key = viewPreferenceKey(snapshot, workspaceRoot)
  const [preference, setPreference] = React.useState<ViewPreference>(DEFAULT_VIEW)
  // 载入是异步的：用户在存档回来之前改了偏好，就不该被存档覆盖。
  const generation = React.useRef(0)

  React.useEffect(() => {
    const current = generation.current + 1
    generation.current = current
    if (key === undefined || workspaceRoot === undefined) {
      setPreference(DEFAULT_VIEW)
      return undefined
    }
    let active = true
    void readViewPreference(store, key, workspaceRoot).then((stored) => {
      if (!active || generation.current !== current) return
      setPreference(stored)
    })
    return () => {
      active = false
    }
  }, [store, key, workspaceRoot])

  const apply = React.useCallback(
    (next: ViewPreference): void => {
      generation.current += 1
      setPreference(next)
      void writeViewPreference(store, key, next)
    },
    [store, key],
  )

  return {
    preference,
    setFilter: (filter) => {
      apply({ ...preference, filter })
    },
    toggleSort: (key) => {
      if (key === preference.sortKey) {
        apply({
          ...preference,
          direction: preference.direction === 'asc' ? 'desc' : 'asc',
        })
        return
      }
      apply({ ...preference, sortKey: key, direction: defaultSortDirection(key) })
    },
    togglePerson: (key) => {
      apply({ ...preference, [key]: !preference[key] })
    },
    clearPeople: () => {
      apply({ ...preference, assignedToMe: false, createdByMe: false })
    },
  }
}

/** 取插件私有存储；面板桥不可用时返回 undefined。 */
function resolvePreferenceStore(): PreferenceStore | undefined {
  const storage = readFrame()?.storage
  if (storage === undefined) return undefined
  if (typeof storage.get !== 'function' || typeof storage.set !== 'function') return undefined
  return {
    get: (key) => storage.get(key),
    set: (key, value) => storage.set(key, value),
  }
}