import { homedir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { OrcaWorkerApi } from './orca-types.ts'
import {
  createWorkspaceResolver,
  type WorkspacePreferenceStore,
} from './workspace-resolver.ts'

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

/** 聚焦上下文；`terminals` 与宿主返回的形状一致。 */
interface ContextRow {
  readonly workspaceId?: string
  readonly displayName: string
  readonly branch: string
  readonly terminals?: readonly { readonly id: string; readonly title?: string }[]
}

/**
 * 造一个上下文可变的宿主：模拟聚焦工作区切换、终端改名。
 * @param initial - 初始上下文。
 * @param workspaces - 工作区列表。
 * @returns 宿主与修改上下文的入口。
 */
function mutableHost(
  initial: ContextRow | null,
  workspaces: readonly WorkspaceRow[],
): { readonly host: OrcaWorkerApi['host']; setContext(next: ContextRow | null): void } {
  let context: ContextRow | null = initial
  return {
    host: {
      async call(method: string) {
        if (method === 'workspace.readContext') return context
        if (method === 'workspace.list') return { workspaces, truncated: false }
        return null
      },
      has: () => true,
    },
    setContext(next) {
      context = next
    },
  }
}

/** 造一份内存里的插件私有存储。 */
function memoryStorage(): WorkspacePreferenceStore & { readonly values: Map<string, unknown> } {
  const values = new Map<string, unknown>()
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value)
    },
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
      contextKey: 'feature-a\u0000feature-a',
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

  it('终端标题里的路径只按完整路径段认领，不被同前缀的兄弟仓库干扰', async () => {
    const base = join(homedir(), 'work')
    const target = join(base, 'orca-mattpocock-workflow')
    const titled = createWorkspaceResolver({
      async call(method: string) {
        if (method === 'workspace.readContext') {
          return {
            displayName: 'main',
            branch: 'main',
            terminals: [{ id: 't1', title: 'zgray@host: ~/work/orca-mattpocock-workflow' }],
          }
        }
        return {
          workspaces: [
            { id: '1', name: 'main', path: join(base, 'orca'), branch: 'main' },
            { id: '2', name: 'main', path: target, branch: 'main' },
            { id: '3', name: 'main', path: join(base, 'orca-mattpocock-workflow-old'), branch: 'main' },
          ],
          truncated: false,
        }
      },
      has: () => true,
    })

    const resolution = await titled.resolve()

    expect(resolution.status === 'resolved' && resolution.root).toBe(target)
  })

  it('终端在嵌套工作区的子目录里时认领最深的那个', async () => {
    const outer = join(homedir(), 'dot')
    const inner = join(outer, 'nested')
    const resolver = createWorkspaceResolver({
      async call(method: string) {
        if (method === 'workspace.readContext') {
          return {
            displayName: 'main',
            branch: 'main',
            terminals: [{ id: 't1', title: 'zgray@host: ~/dot/nested/src' }],
          }
        }
        return {
          workspaces: [
            { id: '1', name: 'main', path: outer, branch: 'main' },
            { id: '2', name: 'main', path: inner, branch: 'main' },
          ],
          truncated: false,
        }
      },
      has: () => true,
    })

    const resolution = await resolver.resolve()

    expect(resolution.status === 'resolved' && resolution.root).toBe(inner)
  })

  it('没有聚焦的工作区时不猜', async () => {
    const resolver = createWorkspaceResolver(host(null, []))

    const resolution = await resolver.resolve()

    expect(resolution).toEqual({ status: 'unresolved', candidates: [], contextKey: '' })
  })

  it('空白显示名不参与名称匹配', async () => {
    const resolver = createWorkspaceResolver(
      host({ displayName: '   ', branch: 'topic' }, [
        { id: '1', name: '', path: '/repo/unnamed', branch: 'main' },
        { id: '2', name: 'topic', path: '/repo/topic', branch: 'topic' },
      ]),
    )

    const resolution = await resolver.resolve()

    expect(resolution.status === 'resolved' && resolution.root).toBe('/repo/topic')
  })

  it('显示名与分支同名时不当成唯一线索', async () => {
    const resolver = createWorkspaceResolver(
      host({ displayName: 'main', branch: 'main' }, [
        { id: '1', name: 'main', path: '/repo/a', branch: 'main' },
        { id: '2', name: 'worktree-2', path: '/repo/b', branch: 'main' },
      ]),
    )

    const resolution = await resolver.resolve()

    expect(resolution.status).toBe('ambiguous')
    expect(
      resolution.status === 'ambiguous' && resolution.candidates.map((item) => item.path),
    ).toEqual(['/repo/a', '/repo/b'])
  })

  it('显示名与分支都没命中时把全部工作区交给面板', async () => {
    const resolver = createWorkspaceResolver(
      host({ displayName: '不存在的名字', branch: '不存在的分支' }, [
        { id: '1', name: 'repo-a', path: '/repo/a', branch: 'x' },
        { id: '2', name: 'repo-b', path: '/repo/b', branch: 'y' },
      ]),
    )

    const resolution = await resolver.resolve()

    expect(resolution.status).toBe('unresolved')
    expect(
      resolution.status === 'unresolved' && resolution.candidates.map((item) => item.path),
    ).toEqual(['/repo/a', '/repo/b'])
  })

  it('同一上下文里认领失败只枚举一次工作区', async () => {
    let listCalls = 0
    const resolver = createWorkspaceResolver({
      async call(method: string) {
        if (method === 'workspace.readContext') return { displayName: 'main', branch: 'main' }
        listCalls += 1
        return {
          workspaces: [
            { id: '1', name: 'main', path: '/repo/a', branch: 'main' },
            { id: '2', name: 'main', path: '/repo/b', branch: 'main' },
          ],
          truncated: false,
        }
      },
      has: () => true,
    })

    await resolver.resolve()
    await resolver.resolve()

    expect(listCalls).toBe(1)
    resolver.invalidate()
    await resolver.resolve()

    expect(listCalls).toBe(2)
  })

  it('显式选择绑定当前上下文，只在该上下文里沿用', async () => {
    const { host: testHost, setContext } = mutableHost(
      { displayName: 'main', branch: 'main' },
      [
        { id: '1', name: 'main', path: '/repo/a', branch: 'main' },
        { id: '2', name: 'main', path: '/repo/b', branch: 'main' },
      ],
    )
    const resolver = createWorkspaceResolver(testHost)

    await resolver.prefer('/repo/b')

    const same = await resolver.resolve()
    expect(same.status === 'resolved' && same.root).toBe('/repo/b')

    setContext({ displayName: 'feature-x', branch: 'feature-x' })
    const other = await resolver.resolve()
    expect(other.status).toBe('unresolved')
  })

  it('显式选择存进私有存储，worker 重启后仍沿用', async () => {
    const { host: testHost } = mutableHost({ displayName: 'main', branch: 'main' }, [
      { id: '1', name: 'main', path: '/repo/a', branch: 'main' },
      { id: '2', name: 'main', path: '/repo/b', branch: 'main' },
    ])
    const storage = memoryStorage()
    const first = createWorkspaceResolver(testHost, storage)

    await first.prefer('/repo/b')
    expect(storage.values.size).toBe(1)

    const restarted = createWorkspaceResolver(testHost, storage)
    const resolution = await restarted.resolve()

    expect(resolution.status === 'resolved' && resolution.root).toBe('/repo/b')
  })

  it('宿主给了工作区 id 时按 id 认领，不受同名同分支干扰', async () => {
    const { host: testHost, setContext } = mutableHost(
      { workspaceId: 'ws-a', displayName: 'main', branch: 'main' },
      [
        { id: 'ws-a', name: 'main', path: '/repo/a', branch: 'main' },
        { id: 'ws-b', name: 'main', path: '/repo/b', branch: 'main' },
      ],
    )
    const resolver = createWorkspaceResolver(testHost)

    const first = await resolver.resolve()
    expect(first.status === 'resolved' && first.root).toBe('/repo/a')

    setContext({ workspaceId: 'ws-b', displayName: 'main', branch: 'main' })
    const second = await resolver.resolve()
    expect(second.status === 'resolved' && second.root).toBe('/repo/b')
    expect(second.contextKey).not.toBe(first.contextKey)
  })

  it('切到另一个同名同分支的工作区后，面板回传的旧路径不会被沿用', async () => {
    const { host: testHost, setContext } = mutableHost(
      { workspaceId: 'ws-a', displayName: 'main', branch: 'main' },
      [
        { id: 'ws-a', name: 'main', path: '/repo/a', branch: 'main' },
        { id: 'ws-b', name: 'main', path: '/repo/b', branch: 'main' },
      ],
    )
    const resolver = createWorkspaceResolver(testHost, memoryStorage())

    // 面板每个请求都带上已认领的路径，worker 把它记成显式选择。
    await resolver.prefer('/repo/a')
    setContext({ workspaceId: 'ws-b', displayName: 'main', branch: 'main' })
    // 切换后、面板同步前的请求仍可能带着旧路径。
    await resolver.prefer('/repo/a')
    resolver.invalidate()

    const resolution = await resolver.resolve()
    expect(resolution.status === 'resolved' && resolution.root).toBe('/repo/b')
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