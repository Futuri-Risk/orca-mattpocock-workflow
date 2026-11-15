import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it } from 'vitest'

import type { WorkspaceCandidate } from './transport.ts'
import { WorkspacePicker } from './workspace-picker.tsx'

const candidates: readonly WorkspaceCandidate[] = [
  {
    id: '1',
    name: 'main',
    path: '/repo/a',
    branch: 'main',
    project: 'xpow',
    kind: 'worktree',
  },
  {
    id: '2',
    name: 'main',
    path: '/repo/b',
    branch: 'main',
    project: 'device-scope',
    kind: 'worktree',
  },
]

describe('工作区候选列表', () => {
  it('每个候选都有明确的使用动作，并显示能区分同分支工作区的信息', () => {
    const markup = renderToStaticMarkup(
      <WorkspacePicker candidates={candidates} onPick={() => undefined} />,
    )

    expect(markup.split('data-testid="workspace-candidate"').length - 1).toBe(2)
    expect(markup.split('data-testid="workspace-candidate-use"').length - 1).toBe(2)
    expect(markup).toContain('点「使用」')
    expect(markup).toContain('xpow · main · main')
    expect(markup).toContain('device-scope · main · main')
    expect(markup).toContain('/repo/a')
    expect(markup).toContain('/repo/b')
  })
})
