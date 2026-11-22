import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it } from 'vitest'

import { MESSAGES } from '../protocol/i18n.ts'
import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import type { WorkspaceSnapshot } from '../protocol/tracker.ts'
import { HierarchyNotice } from './hierarchy-notice.tsx'
import { DEFAULT_VIEW, type ViewPreference } from './view-preference.ts'

const ZH = MESSAGES['zh-CN']

const FLAT: ViewPreference = DEFAULT_VIEW
const HIERARCHY: ViewPreference = { ...FLAT, layout: 'hierarchy' }

function snapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    backend: 'github',
    repository: 'cnzgray/repo',
    repositoryHost: 'github.com',
    fetchedAt: 1_700_000_000_000,
    viewer: null,
    loaded: 2,
    total: 2,
    hasMore: false,
    hierarchy: 'native',
    tickets: [],
    metrics: emptyMetrics(),
    blockersFinalized: true,
    source: 'live',
    stale: false,
    refreshError: null,
    revision: null,
    storeRevision: 0,
    ...overrides,
  }
}

function render(preference: ViewPreference, layout: 'flat' | 'hierarchy', value: WorkspaceSnapshot) {
  return renderToStaticMarkup(
    <HierarchyNotice snapshot={value} preference={preference} layout={layout} />,
  )
}

describe('父子布局提示', () => {
  it('偏好为父子但快照没有父子能力时说明按平铺显示', () => {
    const markup = render(HIERARCHY, 'flat', snapshot({ hierarchy: 'none' }))

    expect(markup).toContain('data-testid="hierarchy-fallback"')
    expect(markup).toContain(ZH['tickets.layout.fallback'])
  })

  it('父子布局生效且样本被截断时说明覆盖范围', () => {
    const markup = render(HIERARCHY, 'hierarchy', snapshot({ loaded: 2, total: 9 }))

    expect(markup).toContain('data-testid="hierarchy-coverage"')
    expect(markup).toContain(ZH['tickets.layout.coverage'].replace('{loaded}', '2').replace('{total}', '9'))
  })

  it('平铺偏好不显示任何父子提示', () => {
    expect(render(FLAT, 'flat', snapshot({ hierarchy: 'none' }))).toBe('')
    expect(render(FLAT, 'flat', snapshot({ loaded: 2, total: 9 }))).toBe('')
  })

  it('父子布局已覆盖全部票时不显示覆盖提示', () => {
    expect(render(HIERARCHY, 'hierarchy', snapshot())).toBe('')
  })
})
