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
    const sorted = { filter: 'open', sortKey: 'status', direction: 'desc' } as const

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
    const legacy = { filter: 'blocked', sortKey: 'updated', direction: 'asc' } as const
    await writeViewPreference(store, MAIN, legacy)

    await expect(
      readViewPreference(store, viewPreferenceKey(github, MAIN), MAIN),
    ).resolves.toEqual(legacy)
  })
})
