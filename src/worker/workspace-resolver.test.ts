import { homedir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { OrcaWorkerApi } from './orca-types.ts'
import { createWorkspaceResolver } from './workspace-resolver.ts'

/** 一个工作区条目。 */
interface WorkspaceRow {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly branch: string | null
}

/** 造一个只会回答工作区两个方法的宿主。 */
function host(
  context: { readonly displayName: string; readonly branch: string } | null,
  workspaces: readonly WorkspaceRow[],
): OrcaWorkerApi['host'] {
  return {
    async call(method: string) {
      if (method === 'workspace.readContext') return context
      if (method === 'workspace.list') return { workspaces, truncated: false }
      return null
    },
    has: () => true,
  }
}

describe('工作区根目录的解析', () => {
  it('显示名唯一命中时直接采用', async () => {
    const resolver = createWorkspaceResolver(
      host({ displayName: 'feature-a', branch: 'feature-a' }, [
        { id: '1', name: 'feature-a', path: '/repo/a', branch: 'feature-a' },
        { id: '2', name: 'feature-b', path: '/repo/b', branch: 'feature-b' },
      ]),
    )

    const resolution = await resolver.resolve()

    expect(resolution).toEqual({
      status: 'resolved',
      root: '/repo/a',
      candidate: {
        id: '1',
        name: 'feature-a',
        path: '/repo/a',
        branch: 'feature-a',
        project: null,
        kind: 'worktree',
      },
    })
  })

  it('显示名没命中时按分支认领', async () => {
    const resolver = createWorkspaceResolver(
      host({ displayName: '面板里的名字', branch: 'feature-b' }, [
        { id: '1', name: 'feature-a', path: '/repo/a', branch: 'feature-a' },
        { id: '2', name: 'feature-b', path: '/repo/b', branch: 'feature-b' },
      ]),
    )

    const resolution = await resolver.resolve()

    expect(resolution.status).toBe('resolved')
    expect(resolution.status === 'resolved' && resolution.root).toBe('/repo/b')
  })

  it('显示名命中多个时用分支再收一次', async () => {
    const resolver = createWorkspaceResolver(
      host({ displayName: 'feature-a', branch: 'topic' }, [
        { id: '1', name: 'feature-a', path: '/repo/a', branch: 'feature-a' },
        { id: '2', name: 'feature-a', path: '/repo/a2', branch: 'topic' },
      ]),
    )

    const resolution = await resolver.resolve()

    expect(resolution.status).toBe('resolved')
    expect(resolution.status === 'resolved' && resolution.root).toBe('/repo/a2')
  })

  it('收窄后仍有多个时把候选交给面板', async () => {
    const resolver = createWorkspaceResolver(
      host({ displayName: 'feature-a', branch: 'topic' }, [
        { id: '1', name: 'feature-a', path: '/repo/a', branch: 'topic' },
        { id: '2', name: 'feature-a', path: '/repo/a2', branch: 'topic' },
      ]),
    )

    const resolution = await resolver.resolve()

    expect(resolution.status).toBe('ambiguous')
    expect(resolution.status === 'ambiguous' && resolution.candidates).toHaveLength(2)
  })

  it('重名时用终端标题里的工作目录认领', async () => {
    const repoB = join(homedir(), 'work', 'repo-b')
    const resolver = createWorkspaceResolver(
      {
        async call(method: string) {
          if (method === 'workspace.readContext') {
            return {
              displayName: 'main',
              branch: 'main',
              terminals: [{ id: 't1', title: 'zgray@host: ~/work/repo-b' }],
            }
          }
          return {
            workspaces: [
              { id: '1', name: 'main', path: join(homedir(), 'work', 'repo-a'), branch: 'main' },
              { id: '2', name: 'main', path: repoB, branch: 'main' },
            ],
            truncated: false,
          }
        },
        has: () => true,
      },
    )

    const resolution = await resolver.resolve()

    expect(resolution.status === 'resolved' && resolution.root).toBe(repoB)
  })

  it('没有聚焦的工作区时不猜', async () => {
    const resolver = createWorkspaceResolver(host(null, []))

    const resolution = await resolver.resolve()

    expect(resolution).toEqual({ status: 'unresolved', candidates: [] })
  })

  it('失效后重新解析工作区列表', async () => {
    let workspaces: readonly WorkspaceRow[] = [
      { id: '1', name: 'feature-a', path: '/repo/a', branch: 'feature-a' },
    ]
    const resolver = createWorkspaceResolver(
      {
        async call(method: string) {
          if (method === 'workspace.readContext') {
            return { displayName: 'feature-a', branch: 'feature-a' }
          }
          return { workspaces, truncated: false }
        },
        has: () => true,
      },
    )

    await resolver.resolve()
    workspaces = [
      { id: '2', name: 'feature-a', path: '/repo/moved', branch: 'feature-a' },
    ]
    resolver.invalidate()

    const resolution = await resolver.resolve()

    expect(resolution.status === 'resolved' && resolution.root).toBe('/repo/moved')
  })
})