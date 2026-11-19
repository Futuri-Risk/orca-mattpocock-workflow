import { describe, expect, it } from 'vitest'

import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import {
  SNAPSHOT_STORE_VERSION,
  parseSnapshotStoreMeta,
  parseSnapshotTicket,
  serializeSnapshotStoreMeta,
  serializeSnapshotTicket,
  type SnapshotStoreMeta,
} from './snapshot-store.ts'
import type { Ticket } from './ticket.ts'

function meta(overrides: Partial<SnapshotStoreMeta> = {}): SnapshotStoreMeta {
  return {
    version: SNAPSHOT_STORE_VERSION,
    storeRevision: 3,
    scopeRoot: '/workspace',
    workspaceRoot: '/workspace',
    backend: 'github',
    repository: 'cnzgray/repo',
    repositoryKey: 'github@github.com/cnzgray/repo',
    repositoryHost: 'github.com',
    fetchedAt: 1_000,
    viewer: 'cnzgray',
    total: 1,
    hierarchy: 'native',
    revision: { id: '1:2026-01-01T00:00:00Z', total: 1 },
    ticketRefs: ['#1'],
    tombstones: [],
    ...overrides,
  }
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
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
    ...overrides,
  }
}

describe('本地快照库的 meta', () => {
  it('序列化后再解析得到同一份 meta', () => {
    const original = meta()

    expect(parseSnapshotStoreMeta(serializeSnapshotStoreMeta(original))).toEqual(original)
  })

  it('分页窗口、墓碑与两个版本号一并保存', () => {
    const original = meta({
      nextCursor: 'cursor-2',
      tombstones: ['#9'],
      revision: null,
    })

    const restored = parseSnapshotStoreMeta(serializeSnapshotStoreMeta(original))

    expect(restored).toEqual(original)
    expect(restored?.nextCursor).toBe('cursor-2')
    expect(restored?.tombstones).toEqual(['#9'])
    expect(restored?.revision).toBeNull()
  })

  it('格式版本不符时按没有缓存处理', () => {
    expect(parseSnapshotStoreMeta(JSON.stringify({ ...meta(), version: 3 }))).toBeUndefined()
  })

  it('提交序号不是非负整数时整份作废', () => {
    expect(
      parseSnapshotStoreMeta(JSON.stringify({ ...meta(), storeRevision: -1 })),
    ).toBeUndefined()
  })

  it('远端版本形状不对时整份作废', () => {
    expect(
      parseSnapshotStoreMeta(JSON.stringify({ ...meta(), revision: { id: '', total: 1 } })),
    ).toBeUndefined()
  })

  it('票引用列表损坏时整份作废', () => {
    expect(
      parseSnapshotStoreMeta(JSON.stringify({ ...meta(), ticketRefs: ['#1', 42] })),
    ).toBeUndefined()
  })

  it('写入时算好的指标随 meta 进出', () => {
    const metrics = emptyMetrics({ openBacklog: 7, readyCapacity: 3 })

    const restored = parseSnapshotStoreMeta(
      serializeSnapshotStoreMeta(meta({ metrics })),
    )

    expect(restored?.metrics).toEqual(metrics)
  })

  it('指标损坏时只丢指标，票数据仍然可用', () => {
    const restored = parseSnapshotStoreMeta(
      JSON.stringify({
        ...meta(),
        metrics: { ...emptyMetrics(), openBacklog: '坏了' },
      }),
    )

    expect(restored).toBeDefined()
    expect(restored?.ticketRefs).toEqual(['#1'])
    expect(restored?.metrics).toBeUndefined()
  })

  it('缺少当前用户时整份作废，不把旧数据当成无身份', () => {
    expect(
      parseSnapshotStoreMeta(JSON.stringify({ ...meta(), viewer: undefined })),
    ).toBeUndefined()
  })

  it('内容不是 JSON 时按没有缓存处理', () => {
    expect(parseSnapshotStoreMeta('not json')).toBeUndefined()
  })
})

describe('本地快照库的票文件', () => {
  it('序列化后再解析得到同一张票', () => {
    const original = ticket()

    expect(parseSnapshotTicket(serializeSnapshotTicket(original))).toEqual(original)
  })

  it('链接、父级与阻塞引用随票保存', () => {
    const original = ticket({
      url: 'https://github.com/cnzgray/repo/issues/1',
      parent: '#2',
      blockedBy: ['#3'],
      closedAt: '2026-01-02T00:00:00Z',
    })

    expect(parseSnapshotTicket(serializeSnapshotTicket(original))).toEqual(original)
  })

  it('工单字段不合法时整票作废', () => {
    expect(parseSnapshotTicket(JSON.stringify({ ref: '#1' }))).toBeUndefined()
  })

  it('链接不是非空字符串时整票作废', () => {
    expect(
      parseSnapshotTicket(JSON.stringify({ ...ticket(), url: 42 })),
    ).toBeUndefined()
  })

  it('分配人不是字符串数组时整票作废', () => {
    expect(
      parseSnapshotTicket(JSON.stringify({ ...ticket(), assignees: ['alice', 42] })),
    ).toBeUndefined()
  })

  it('内容不是 JSON 时整票作废', () => {
    expect(parseSnapshotTicket('not json')).toBeUndefined()
  })
})
