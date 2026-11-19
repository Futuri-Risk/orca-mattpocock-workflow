import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearDetailCache,
  detailCacheDecision,
  readDetailCache,
  writeDetailCache,
} from './detail-cache.ts'
import { makeDetail } from './ticket-detail-test-support.ts'

beforeEach(() => {
  clearDetailCache()
})

describe('详情缓存决策', () => {
  it('没有缓存是 miss，时间一致是 hit，时间变化是 stale', () => {
    const hit = { detail: makeDetail(), updatedAt: '2026-11-02T00:00:00Z' }

    expect(detailCacheDecision(null, '2026-11-02T00:00:00Z')).toBe('miss')
    expect(detailCacheDecision(hit, '2026-11-02T00:00:00Z')).toBe('hit')
    expect(detailCacheDecision(hit, '2026-11-03T00:00:00Z')).toBe('stale')
    // 列表里没有这张票的时间时不能当成没变。
    expect(detailCacheDecision(hit, undefined)).toBe('stale')
  })
})

describe('详情缓存存储', () => {
  it('按工作区隔离读写，写回覆盖旧详情', () => {
    const first = makeDetail({ title: '旧标题' })
    writeDetailCache('/a', first)
    expect(readDetailCache('/a', '#18')?.detail.title).toBe('旧标题')
    expect(readDetailCache('/b', '#18')).toBeNull()

    const updated = makeDetail({ title: '新标题', updatedAt: '2026-11-09T00:00:00Z' })
    writeDetailCache('/a', updated)
    expect(readDetailCache('/a', '#18')).toEqual({
      detail: updated,
      updatedAt: '2026-11-09T00:00:00Z',
    })
  })

  it('每个工作区超过上限时淘汰最久没看过的票', () => {
    for (let index = 0; index < 101; index += 1) {
      writeDetailCache(
        '/a',
        makeDetail({ ref: `#${String(index)}`, number: index, title: `票 ${String(index)}` }),
      )
    }

    expect(readDetailCache('/a', '#0')).toBeNull()
    expect(readDetailCache('/a', '#100')).not.toBeNull()
  })

  it('工作区数量超过上限时淘汰最久没动过的工作区', () => {
    for (let index = 0; index < 6; index += 1) {
      const root = `/ws-${String(index)}`
      writeDetailCache(root, makeDetail({ ref: `#${String(index)}`, number: index }))
      // 每个工作区至少写一张，保证缓存里是 6 个不同的键。
    }

    expect(readDetailCache('/ws-0', '#0')).toBeNull()
    expect(readDetailCache('/ws-5', '#5')).not.toBeNull()
  })

  it('可以只清一个工作区或全部清空', () => {
    writeDetailCache('/a', makeDetail())
    writeDetailCache('/b', makeDetail())

    clearDetailCache('/a')
    expect(readDetailCache('/a', '#18')).toBeNull()
    expect(readDetailCache('/b', '#18')).not.toBeNull()

    clearDetailCache()
    expect(readDetailCache('/b', '#18')).toBeNull()
  })
})
