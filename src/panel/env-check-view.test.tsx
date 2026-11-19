// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EnvCheckReport } from '../protocol/env-check.ts'
import type { RpcResult, SnapshotCacheInfo } from '../protocol/tracker.ts'
import { find, render, setupDom, teardownDom } from './dom-test-support.ts'
import { EnvCheckView } from './env-check-view.tsx'
import type { PromptCopy } from './injection.ts'
import { ok } from './ticket-detail-test-support.ts'
import type { PanelClient } from './transport.ts'

const COPY: PromptCopy = {
  canCopy: true,
  copy: async () => ({ outcome: 'copied', reason: null }),
}

const CACHE_INFO: SnapshotCacheInfo = {
  location: '~/.orca-mattpocock-workflow/cache',
  entries: 1,
  lastWrittenAt: null,
  cleared: 0,
}

beforeEach(() => {
  setupDom()
})

afterEach(async () => {
  await teardownDom()
})

describe('环境检查视图的检查时刻', () => {
  it('报告落地后显示检查时刻，命中缓存也能看出数据有多旧', async () => {
    const report: EnvCheckReport = {
      checkedAt: Date.now() - 3 * 60 * 1000,
      backend: 'github',
      repository: 'acme/repo',
      items: [
        {
          id: 'home',
          subject: null,
          status: 'pass',
          detail: '/home/me',
          remedy: null,
          blockedBy: null,
        },
      ],
      capabilities: [],
    }
    const client = {
      envCheck: vi.fn<PanelClient['envCheck']>(async () => ok(report)),
      cache: vi.fn<PanelClient['cache']>(
        async (): Promise<RpcResult<SnapshotCacheInfo>> => ok(CACHE_INFO),
      ),
    } as unknown as PanelClient

    await render(
      <EnvCheckView
        client={client}
        workspaceRoot="/ws"
        copy={COPY}
        clientCapabilities={() => []}
      />,
    )

    const checkedAt = find('env-checked-at')
    expect(checkedAt).not.toBeNull()
    expect(checkedAt?.textContent?.length).toBeGreaterThan(0)
  })
})
