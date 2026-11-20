import { describe, expect, it } from 'vitest'

import {
  DEFAULT_VIEW,
  readViewPreference,
  viewPreferenceKey,
  writeViewPreference,
  type PreferenceStore,
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

describe('视图偏好按仓库归并', () => {
  it('同一仓库的两个 worktree 共用一份偏好', async () => {
    const store = memoryStore()
    const sorted = {
      filter: 'open',
      sortKey: 'status',
      direction: 'desc',
      assignedToMe: true,
      createdByMe: false,
      layout: 'hierarchy',
      showUpdatedAt: false,
      showAssignee: false,
    } as const

    await writeViewPreference(store, viewPreferenceKey(github, MAIN), sorted)

    await expect(
      readViewPreference(store, viewPreferenceKey(github, WORKTREE), WORKTREE),
    ).resolves.toEqual(sorted)
  })

  it('不同仓库各自一份', async () => {
    const store = memoryStore()
    await writeViewPreference(store, viewPreferenceKey(github, MAIN), {
      filter: 'closed',
      sortKey: 'number',
      direction: 'desc',
      assignedToMe: false,
      createdByMe: false,
      layout: 'flat',
      showUpdatedAt: false,
      showAssignee: false,
    })
    const other = { ...github, repository: 'o/other' }

    await expect(
      readViewPreference(store, viewPreferenceKey(other, WORKTREE), WORKTREE),
    ).resolves.toEqual(DEFAULT_VIEW)
  })

  it('本地 Markdown 按工作区隔离', async () => {
    const store = memoryStore()
    const markdown = { backend: 'markdown', repositoryHost: null, repository: 'local' } as const
    await writeViewPreference(store, viewPreferenceKey(markdown, MAIN), {
      filter: 'all',
      sortKey: 'title',
      direction: 'asc',
      assignedToMe: false,
      createdByMe: false,
      layout: 'flat',
      showUpdatedAt: false,
      showAssignee: false,
    })

    await expect(
      readViewPreference(store, viewPreferenceKey(markdown, WORKTREE), WORKTREE),
    ).resolves.toEqual(DEFAULT_VIEW)
  })

  it('快照还没回来时没有键，不读不写', () => {
    expect(viewPreferenceKey(null, MAIN)).toBeUndefined()
  })

  it('升级前按工作区存的偏好仍然读得到', async () => {
    const store = memoryStore()
    const legacy = {
      filter: 'blocked',
      sortKey: 'updated',
      direction: 'asc',
      assignedToMe: false,
      createdByMe: false,
      layout: 'hierarchy',
      showUpdatedAt: false,
      showAssignee: false,
    } as const
    await writeViewPreference(store, MAIN, legacy)

    await expect(
      readViewPreference(store, viewPreferenceKey(github, MAIN), MAIN),
    ).resolves.toEqual(legacy)
  })

  it('旧存档没有布局字段时默认平铺', async () => {
    const store = memoryStore()
    const legacy = { filter: 'closed', sortKey: 'updated', direction: 'desc' } as const
    await writeViewPreference(store, viewPreferenceKey(github, MAIN), DEFAULT_VIEW)
    // 直接改写存档，模拟升级前写下的条目：布局字段缺失。
    const key = viewPreferenceKey(github, MAIN)
    if (key === undefined) throw new Error('偏好键不应为空')
    const map = JSON.parse(String(store.data.get('view-preferences'))) as {
      entries: Record<string, unknown>
    }
    map.entries[key] = { ...legacy, savedAt: 1 }
    store.data.set('view-preferences', JSON.stringify(map))

    await expect(readViewPreference(store, key, MAIN)).resolves.toEqual({
      ...legacy,
      assignedToMe: false,
      createdByMe: false,
      layout: 'flat',
      showUpdatedAt: false,
      showAssignee: false,
    })
  })

  it('布局字段非法时退回平铺', async () => {
    const store = memoryStore()
    await writeViewPreference(store, viewPreferenceKey(github, MAIN), {
      ...DEFAULT_VIEW,
      layout: 'flat',
    })
    const key = viewPreferenceKey(github, MAIN)
    if (key === undefined) throw new Error('偏好键不应为空')
    const map = JSON.parse(String(store.data.get('view-preferences'))) as {
      entries: Record<string, unknown>
    }
    map.entries[key] = { ...DEFAULT_VIEW, layout: 'rows', savedAt: 1 }
    store.data.set('view-preferences', JSON.stringify(map))

    const preference = await readViewPreference(store, key, MAIN)

    expect(preference.layout).toBe('flat')
    expect(preference.filter).toBe(DEFAULT_VIEW.filter)
  })

  it('存储不可用时退回默认视图（含平铺布局）', async () => {
    await expect(readViewPreference(undefined, 'github@github.com/o/r')).resolves.toEqual(
      DEFAULT_VIEW,
    )
    expect(DEFAULT_VIEW.layout).toBe('flat')
  })
})

describe('行内信息开关', () => {
  it('默认不显示更新时间与分配人', () => {
    expect(DEFAULT_VIEW.showUpdatedAt).toBe(false)
    expect(DEFAULT_VIEW.showAssignee).toBe(false)
  })

  it('两个开关按 true 写入后原样读回', async () => {
    const store = memoryStore()
    const details = {
      filter: 'open',
      sortKey: 'status',
      direction: 'asc',
      assignedToMe: false,
      createdByMe: false,
      layout: 'flat',
      showUpdatedAt: true,
      showAssignee: true,
    } as const

    await writeViewPreference(store, viewPreferenceKey(github, MAIN), details)

    await expect(
      readViewPreference(store, viewPreferenceKey(github, MAIN)),
    ).resolves.toEqual(details)
  })

  it('旧记录缺字段时按 false 读，筛选、排序与布局保留', async () => {
    const store = memoryStore()
    const key = viewPreferenceKey(github, MAIN)
    if (key === undefined) throw new Error('需要偏好键')
    store.data.set(
      'view-preferences',
      JSON.stringify({
        version: 1,
        entries: {
          [key]: {
            filter: 'blocked',
            sortKey: 'updated',
            direction: 'desc',
            layout: 'hierarchy',
            savedAt: 1,
          },
        },
      }),
    )

    await expect(readViewPreference(store, key)).resolves.toEqual({
      filter: 'blocked',
      sortKey: 'updated',
      direction: 'desc',
      assignedToMe: false,
      createdByMe: false,
      layout: 'hierarchy',
      showUpdatedAt: false,
      showAssignee: false,
    })
  })

  it('单个开关非法时只回退该字段，另一个开关与其它字段保留', async () => {
    const store = memoryStore()
    const key = viewPreferenceKey(github, MAIN)
    if (key === undefined) throw new Error('需要偏好键')
    store.data.set(
      'view-preferences',
      JSON.stringify({
        version: 1,
        entries: {
          [key]: {
            filter: 'closed',
            sortKey: 'title',
            direction: 'asc',
            layout: 'flat',
            showUpdatedAt: true,
            showAssignee: 'yes',
            savedAt: 1,
          },
        },
      }),
    )

    await expect(readViewPreference(store, key)).resolves.toEqual({
      filter: 'closed',
      sortKey: 'title',
      direction: 'asc',
      assignedToMe: false,
      createdByMe: false,
      layout: 'flat',
      showUpdatedAt: true,
      showAssignee: false,
    })
  })

  it('行内信息开关按仓库各自保存，不互相污染', async () => {
    const store = memoryStore()
    const other = { ...github, repository: 'o/other' }
    await writeViewPreference(store, viewPreferenceKey(github, MAIN), {
      ...DEFAULT_VIEW,
      showUpdatedAt: true,
    })

    await expect(
      readViewPreference(store, viewPreferenceKey(other, MAIN)),
    ).resolves.toEqual(DEFAULT_VIEW)
  })
})

describe('人员开关的读写与回退', () => {
  it('默认视图不按人员过滤', () => {
    expect(DEFAULT_VIEW.assignedToMe).toBe(false)
    expect(DEFAULT_VIEW.createdByMe).toBe(false)
  })

  it('两个开关按 true 写入后原样读回', async () => {
    const store = memoryStore()
    const people = {
      filter: 'open',
      sortKey: 'status',
      direction: 'asc',
      assignedToMe: true,
      createdByMe: true,
      layout: 'flat',
      showUpdatedAt: false,
      showAssignee: false,
    } as const

    await writeViewPreference(store, viewPreferenceKey(github, MAIN), people)

    await expect(readViewPreference(store, viewPreferenceKey(github, MAIN))).resolves.toEqual(people)
  })

  it('旧记录没有两个字段时按 false 读，筛选与排序保留', async () => {
    const store = memoryStore()
    const key = viewPreferenceKey(github, MAIN)
    if (key === undefined) throw new Error('需要偏好键')
    store.data.set(
      'view-preferences',
      JSON.stringify({
        version: 1,
        entries: {
          [key]: { filter: 'closed', sortKey: 'title', direction: 'desc', savedAt: 1 },
        },
      }),
    )

    await expect(readViewPreference(store, key)).resolves.toEqual({
      filter: 'closed',
      sortKey: 'title',
      direction: 'desc',
      assignedToMe: false,
      createdByMe: false,
      layout: 'flat',
      showUpdatedAt: false,
      showAssignee: false,
    })
  })

  it('某个开关非法时只回退该字段，其他字段保留', async () => {
    const store = memoryStore()
    const key = viewPreferenceKey(github, MAIN)
    if (key === undefined) throw new Error('需要偏好键')
    store.data.set(
      'view-preferences',
      JSON.stringify({
        version: 1,
        entries: {
          [key]: {
            filter: 'blocked',
            sortKey: 'updated',
            direction: 'asc',
            assignedToMe: 'yes',
            createdByMe: true,
            savedAt: 1,
          },
        },
      }),
    )

    await expect(readViewPreference(store, key)).resolves.toEqual({
      filter: 'blocked',
      sortKey: 'updated',
      direction: 'asc',
      assignedToMe: false,
      createdByMe: true,
      layout: 'flat',
      showUpdatedAt: false,
      showAssignee: false,
    })
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
