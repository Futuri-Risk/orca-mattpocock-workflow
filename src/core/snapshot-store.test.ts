import { describe, expect, it } from 'vitest'

import {
  SNAPSHOT_STORE_VERSION,
  parseSnapshotStoreEntry,
  serializeSnapshotStoreEntry,
  type SnapshotStoreEntry,
} from './snapshot-store.ts'

function entry(overrides: Partial<SnapshotStoreEntry> = {}): SnapshotStoreEntry {
  return {
    version: SNAPSHOT_STORE_VERSION,
    scopeRoot: '/workspace',
    workspaceRoot: '/workspace',
    backend: 'github',
    repository: 'cnzgray/repo',
    repositoryKey: 'github@github.com/cnzgray/repo',
    repositoryHost: 'github.com',
    fetchedAt: 1_000,
    viewer: 'cnzgray',
    loaded: 1,
    total: 1,
    tickets: [
      {
        ref: '#1',
        number: 1,
        title: '一张票',
        state: 'open',
        labels: ['ready-for-agent'],
        author: { login: 'cnzgray', displayName: null, avatarUrl: null },
        assignees: ['cnzgray'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        openBlockers: 0,
      },
    ],
    ...overrides,
  }
}

describe('本地快照库条目', () => {
  it('序列化后再解析得到同一份条目', () => {
    const original = entry()

    expect(parseSnapshotStoreEntry(serializeSnapshotStoreEntry(original))).toEqual(original)
  })

  it('分页窗口与游标一并保存，重启后还能继续加载', () => {
    const original = entry({ loaded: 100, total: 11_162, nextCursor: 'cursor-2' })

    const restored = parseSnapshotStoreEntry(serializeSnapshotStoreEntry(original))

    expect(restored).toEqual(original)
    expect(restored?.nextCursor).toBe('cursor-2')
  })

  it('游标不是非空字符串时整份作废', () => {
    const raw = JSON.stringify({ ...entry(), nextCursor: 42 })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('格式版本不符时按没有缓存处理', () => {
    const raw = serializeSnapshotStoreEntry(entry({ version: 99 }))

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('升级前按工作区存的旧条目（版本 1）读不出来', () => {
    const raw = JSON.stringify({ ...entry(), version: 1 })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('缺少仓库作用域时按没有缓存处理', () => {
    const raw = JSON.stringify({ ...entry(), scopeRoot: undefined })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('内容不是 JSON 时按没有缓存处理', () => {
    expect(parseSnapshotStoreEntry('not json')).toBeUndefined()
  })

  it('工单字段不合法时整份作废', () => {
    const raw = JSON.stringify({ ...entry(), tickets: [{ ref: '#1' }] })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('后端类型不认识时按没有缓存处理', () => {
    const raw = JSON.stringify({ ...entry(), backend: 'bitbucket' })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('缺少仓库身份时按没有缓存处理', () => {
    const raw = JSON.stringify({ ...entry(), repositoryKey: undefined })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('老记录没有头像字段时按没有头像处理', () => {
    const old = entry()
    const legacy = {
      ...old,
      tickets: [
        {
          ...old.tickets[0],
          author: { login: 'cnzgray', displayName: null },
        },
      ],
    }

    const parsed = parseSnapshotStoreEntry(JSON.stringify(legacy))

    expect(parsed?.tickets[0]?.author?.avatarUrl).toBeNull()
  })

  it('当前用户为 null 的条目合法', () => {
    const original = entry({ viewer: null })

    const parsed = parseSnapshotStoreEntry(serializeSnapshotStoreEntry(original))

    expect(parsed?.viewer).toBeNull()
  })

  it('缺少当前用户时整份作废，不把旧数据当成无身份', () => {
    const raw = JSON.stringify({ ...entry(), viewer: undefined })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('当前用户类型不对时整份作废', () => {
    const raw = JSON.stringify({ ...entry(), viewer: 42 })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('分配人不是字符串数组时整份作废', () => {
    const old = entry()
    const raw = JSON.stringify({
      ...old,
      tickets: [{ ...old.tickets[0], assignees: ['alice', 42] }],
    })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('缺少分配人时整份作废，旧缓存自动重拉', () => {
    const old = entry()
    const raw = JSON.stringify({
      ...old,
      tickets: [{ ...old.tickets[0], assignees: undefined }],
    })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('上一版（版本 2）的条目读不出来', () => {
    const raw = JSON.stringify({ ...entry(), version: 2 })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })
})
