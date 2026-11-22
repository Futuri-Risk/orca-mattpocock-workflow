import { describe, expect, it } from 'vitest'

import {
  DEFAULT_VIEW,
  readViewPreference,
  viewPreferenceKey,
  writeViewPreference,
  type PreferenceStore,
  type ViewPreference,
} from './view-preference.ts'

function memoryStore(): PreferenceStore & { readonly data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    get: (key) => Promise.resolve(data.get(key)),
    set: (key, value) => {
      data.set(key, value)
      return Promise.resolve()
    },
  }
}

const MAIN = '/repo/main'
const WORKTREE = '/worktrees/bugfix-10'
const github = { backend: 'github', repositoryHost: 'github.com', repository: 'o/r' } as const

/** 一份完整的偏好；测试只覆盖关心的字段。 */
function preference(overrides: Partial<ViewPreference> = {}): ViewPreference {
  return { ...DEFAULT_VIEW, ...overrides }
}

/** 直接改写存档里的一个条目，模拟旧版本写下的记录。 */
function seedEntry(
  store: PreferenceStore & { readonly data: Map<string, unknown> },
  key: string,
  entry: Readonly<Record<string, unknown>>,
): void {
  store.data.set(
    'view-preferences',
    JSON.stringify({ version: 1, entries: { [key]: { ...entry, savedAt: 1 } } }),
  )
}

function storedKey(overrides: Partial<typeof github> = {}): string {
  const key = viewPreferenceKey({ ...github, ...overrides }, MAIN)
  if (key === undefined) throw new Error('偏好键不应为空')
  return key
}

describe('视图偏好按仓库归并', () => {
  it('同一仓库的两个 worktree 共用一份偏好', async () => {
    const store = memoryStore()
    const sorted = preference({
      direction: 'desc',
      assignedToMe: true,
      layout: 'hierarchy',
    })

    await writeViewPreference(store, viewPreferenceKey(github, MAIN), sorted)

    await expect(
      readViewPreference(store, viewPreferenceKey(github, WORKTREE), WORKTREE),
    ).resolves.toEqual(sorted)
  })

  it('不同仓库各自一份', async () => {
    const store = memoryStore()
    await writeViewPreference(
      store,
      viewPreferenceKey(github, MAIN),
      preference({ filter: 'closed', sortKey: 'number', direction: 'desc' }),
    )
    const other = { ...github, repository: 'o/other' }

    await expect(
      readViewPreference(store, viewPreferenceKey(other, WORKTREE), WORKTREE),
    ).resolves.toEqual(DEFAULT_VIEW)
  })

  it('本地 Markdown 按工作区隔离', async () => {
    const store = memoryStore()
    const markdown = { backend: 'markdown', repositoryHost: null, repository: 'local' } as const
    await writeViewPreference(
      store,
      viewPreferenceKey(markdown, MAIN),
      preference({ filter: 'all', sortKey: 'title', direction: 'asc' }),
    )

    await expect(
      readViewPreference(store, viewPreferenceKey(markdown, WORKTREE), WORKTREE),
    ).resolves.toEqual(DEFAULT_VIEW)
  })

  it('快照还没回来时没有键，不读不写', () => {
    expect(viewPreferenceKey(null, MAIN)).toBeUndefined()
  })

  it('升级前按工作区存的偏好仍然读得到', async () => {
    const store = memoryStore()
    const legacy = preference({ filter: 'blocked', sortKey: 'updated', layout: 'hierarchy' })
    await writeViewPreference(store, MAIN, legacy)

    await expect(
      readViewPreference(store, viewPreferenceKey(github, MAIN), MAIN),
    ).resolves.toEqual(legacy)
  })

  it('旧存档没有布局字段时默认平铺', async () => {
    const store = memoryStore()
    const key = storedKey()
    seedEntry(store, key, { filter: 'closed', sortKey: 'updated', direction: 'desc' })

    await expect(readViewPreference(store, key, MAIN)).resolves.toEqual({
      filter: 'closed',
      sortKey: 'updated',
      direction: 'desc',
      assignedToMe: false,
      createdByMe: false,
      layout: 'flat',
      showAuthor: true,
      showCreatedAt: true,
      showUpdatedAt: false,
      showAssignees: false,
    })
  })

  it('布局字段非法时退回平铺', async () => {
    const store = memoryStore()
    const key = storedKey()
    seedEntry(store, key, { ...preference(), layout: 'rows' })

    const stored = await readViewPreference(store, key, MAIN)

    expect(stored.layout).toBe('flat')
    expect(stored.filter).toBe(DEFAULT_VIEW.filter)
  })

  it('存储不可用时退回默认视图（含平铺布局）', async () => {
    await expect(readViewPreference(undefined, 'github@github.com/o/r')).resolves.toEqual(
      DEFAULT_VIEW,
    )
    expect(DEFAULT_VIEW.layout).toBe('flat')
  })
})

describe('行内显示开关', () => {
  it('默认显示创建人与创建时间，不显示更新时间与分配人', () => {
    expect(DEFAULT_VIEW.showAuthor).toBe(true)
    expect(DEFAULT_VIEW.showCreatedAt).toBe(true)
    expect(DEFAULT_VIEW.showUpdatedAt).toBe(false)
    expect(DEFAULT_VIEW.showAssignees).toBe(false)
  })

  it('四个开关写入后原样读回', async () => {
    const store = memoryStore()
    const details = preference({
      filter: 'closed',
      sortKey: 'number',
      direction: 'desc',
      showAuthor: false,
      showCreatedAt: false,
      showUpdatedAt: true,
      showAssignees: true,
    })

    await writeViewPreference(store, viewPreferenceKey(github, MAIN), details)

    await expect(readViewPreference(store, viewPreferenceKey(github, MAIN))).resolves.toEqual(
      details,
    )
  })

  it('旧记录缺四个字段时按各自默认值读，其余偏好保留', async () => {
    const store = memoryStore()
    const key = storedKey()
    seedEntry(store, key, {
      filter: 'blocked',
      sortKey: 'updated',
      direction: 'desc',
      layout: 'hierarchy',
    })

    await expect(readViewPreference(store, key)).resolves.toEqual({
      filter: 'blocked',
      sortKey: 'updated',
      direction: 'desc',
      assignedToMe: false,
      createdByMe: false,
      layout: 'hierarchy',
      showAuthor: true,
      showCreatedAt: true,
      showUpdatedAt: false,
      showAssignees: false,
    })
  })

  it('单个开关非法时只回退该字段，其余开关与偏好保留', async () => {
    const store = memoryStore()
    const key = storedKey()
    seedEntry(store, key, {
      filter: 'closed',
      sortKey: 'title',
      direction: 'asc',
      layout: 'flat',
      showAuthor: 'yes',
      showCreatedAt: false,
      showUpdatedAt: true,
      showAssignees: true,
    })

    await expect(readViewPreference(store, key)).resolves.toEqual({
      filter: 'closed',
      sortKey: 'title',
      direction: 'asc',
      assignedToMe: false,
      createdByMe: false,
      layout: 'flat',
      showAuthor: true,
      showCreatedAt: false,
      showUpdatedAt: true,
      showAssignees: true,
    })
  })

  it('行内显示开关按仓库各自保存，不互相污染', async () => {
    const store = memoryStore()
    const other = { ...github, repository: 'o/other' }
    await writeViewPreference(
      store,
      viewPreferenceKey(github, MAIN),
      preference({ showUpdatedAt: true, showAssignees: true }),
    )

    await expect(readViewPreference(store, viewPreferenceKey(other, MAIN))).resolves.toEqual(
      DEFAULT_VIEW,
    )
  })
})

describe('人员开关的读写与回退', () => {
  it('默认视图不按人员过滤', () => {
    expect(DEFAULT_VIEW.assignedToMe).toBe(false)
    expect(DEFAULT_VIEW.createdByMe).toBe(false)
  })

  it('两个开关按 true 写入后原样读回', async () => {
    const store = memoryStore()
    const people = preference({ assignedToMe: true, createdByMe: true })

    await writeViewPreference(store, viewPreferenceKey(github, MAIN), people)

    await expect(readViewPreference(store, viewPreferenceKey(github, MAIN))).resolves.toEqual(people)
  })

  it('旧记录没有两个字段时按 false 读，筛选与排序保留', async () => {
    const store = memoryStore()
    const key = storedKey()
    seedEntry(store, key, { filter: 'closed', sortKey: 'title', direction: 'desc' })

    await expect(readViewPreference(store, key)).resolves.toEqual(preference({
      filter: 'closed',
      sortKey: 'title',
      direction: 'desc',
    }))
  })

  it('某个开关非法时只回退该字段，其他字段保留', async () => {
    const store = memoryStore()
    const key = storedKey()
    seedEntry(store, key, {
      filter: 'blocked',
      sortKey: 'updated',
      direction: 'asc',
      assignedToMe: 'yes',
      createdByMe: true,
    })

    await expect(readViewPreference(store, key)).resolves.toEqual(preference({
      filter: 'blocked',
      sortKey: 'updated',
      direction: 'asc',
      createdByMe: true,
    }))
  })

  it('存储抛错时返回默认视图，不把异常带到界面', async () => {
    const store: PreferenceStore = {
      get: () => Promise.reject(new Error('denied')),
      set: () => Promise.reject(new Error('denied')),
    }

    await expect(readViewPreference(store, viewPreferenceKey(github, MAIN))).resolves.toEqual(
      DEFAULT_VIEW,
    )
    await expect(
      writeViewPreference(store, viewPreferenceKey(github, MAIN), DEFAULT_VIEW),
    ).resolves.toBeUndefined()
  })
})
