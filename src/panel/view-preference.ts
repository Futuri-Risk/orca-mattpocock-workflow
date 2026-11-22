/**
 * 视图偏好：按仓库记住筛选、排序键、方向、两个人员开关、四个行内显示开关与布局。
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
import type { TicketLayout } from './ticket-tree.ts'
import {
  defaultSortDirection,
  type PeopleFilter,
  type PersonFilterKey,
  type SortDirection,
  type TicketFilter,
  type TicketSortKey,
} from './ticket-view.ts'

/**
 * 行内可配置显示的四个字段。前两个默认打开，保持加入开关前的行内容；
 * 更新时间与分配人默认关闭，不看这两项的用户不受影响。
 */
export interface RowFields {
  /** 行内是否显示创建人头像与用户名。 */
  readonly showAuthor: boolean
  /** 行内是否显示相对创建时间。 */
  readonly showCreatedAt: boolean
  /** 行内是否显示相对更新时间。 */
  readonly showUpdatedAt: boolean
  /** 行内是否显示分配人登录名。 */
  readonly showAssignees: boolean
}

/** 面板的一份视图偏好。 */
export interface ViewPreference extends PeopleFilter, RowFields {
  readonly filter: TicketFilter
  readonly sortKey: TicketSortKey
  readonly direction: SortDirection
  /** 列表布局；默认平铺，按仓库记住。 */
  readonly layout: TicketLayout
}

/** 行内显示开关的字段名。 */
export type RowField = keyof RowFields

/** 行内显示开关的默认值：创建人与创建时间打开，更新时间与分配人关闭。 */
export const DEFAULT_ROW_FIELDS: RowFields = {
  showAuthor: true,
  showCreatedAt: true,
  showUpdatedAt: false,
  showAssignees: false,
}

/** 没有存档时使用的视图：只看未关闭工单，可接的排在前面，不按人员过滤，平铺布局。 */
export const DEFAULT_VIEW: ViewPreference = {
  filter: 'open',
  sortKey: 'status',
  direction: 'asc',
  assignedToMe: false,
  createdByMe: false,
  layout: 'flat',
  ...DEFAULT_ROW_FIELDS,
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
interface StoredEntry extends PeopleFilter, RowFields {
  readonly filter: TicketFilter
  readonly sortKey: TicketSortKey
  readonly direction: SortDirection
  readonly layout: TicketLayout
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

const LAYOUTS: Record<TicketLayout, true> = { flat: true, hierarchy: true }

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

  // 旧记录缺字段时的回退已在 toEntry 里逐字段完成：两个人员开关与更新 / 分配人
  // 按 false 读，创建人与创建时间按 true 读，布局按平铺读。
  return {
    filter: stored.filter,
    sortKey: stored.sortKey,
    direction: stored.direction,
    assignedToMe: stored.assignedToMe,
    createdByMe: stored.createdByMe,
    layout: stored.layout,
    showAuthor: stored.showAuthor,
    showCreatedAt: stored.showCreatedAt,
    showUpdatedAt: stored.showUpdatedAt,
    showAssignees: stored.showAssignees,
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
      layout: preference.layout,
      showAuthor: preference.showAuthor,
      showCreatedAt: preference.showCreatedAt,
      showUpdatedAt: preference.showUpdatedAt,
      showAssignees: preference.showAssignees,
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
  const record = value as Readonly<Record<string, unknown>>
  if (!isFilter(record.filter)) return null
  if (!isSortKey(record.sortKey)) return null
  if (!isDirection(record.direction)) return null
  return {
    filter: record.filter,
    sortKey: record.sortKey,
    direction: record.direction,
    assignedToMe: isBoolean(record.assignedToMe) ? record.assignedToMe : DEFAULT_VIEW.assignedToMe,
    createdByMe: isBoolean(record.createdByMe) ? record.createdByMe : DEFAULT_VIEW.createdByMe,
    layout: isLayout(record.layout) ? record.layout : DEFAULT_VIEW.layout,
    // 四个行内显示开关按各自默认值回退：创建人与创建时间默认开，另两个默认关。
    showAuthor: isBoolean(record.showAuthor) ? record.showAuthor : DEFAULT_VIEW.showAuthor,
    showCreatedAt: isBoolean(record.showCreatedAt)
      ? record.showCreatedAt
      : DEFAULT_VIEW.showCreatedAt,
    showUpdatedAt: isBoolean(record.showUpdatedAt)
      ? record.showUpdatedAt
      : DEFAULT_VIEW.showUpdatedAt,
    showAssignees: isBoolean(record.showAssignees)
      ? record.showAssignees
      : DEFAULT_VIEW.showAssignees,
    savedAt: typeof record.savedAt === 'number' ? record.savedAt : 0,
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

function isLayout(value: unknown): value is TicketLayout {
  return typeof value === 'string' && Object.hasOwn(LAYOUTS, value)
}

/** 行内显示开关只接受布尔值；其它类型按字段默认值回退。 */
function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
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
  readonly setLayout: (layout: TicketLayout) => void
  /** 切换一个行内显示开关；其余开关不受影响。 */
  readonly toggleRowField: (field: RowField) => void
}

/**
 * 读取并按仓库维护视图偏好。存储不可用时全部退回默认视图。
 * @param workspaceRoot - 当前工作区根路径。
 * @param snapshot - 当前快照；偏好键由它的仓库身份决定，还没拿到时用默认视图。
 * @returns 当前偏好与筛选、排序、人员开关、行内显示开关、布局入口。
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

  const toggleField = (field: PersonFilterKey | RowField): void => {
    apply({ ...preference, [field]: !preference[field] })
  }

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
    togglePerson: toggleField,
    clearPeople: () => {
      apply({ ...preference, assignedToMe: false, createdByMe: false })
    },
    setLayout: (layout) => {
      apply({ ...preference, layout })
    },
    toggleRowField: toggleField,
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