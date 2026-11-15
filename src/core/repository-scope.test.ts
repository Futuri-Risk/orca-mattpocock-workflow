import { describe, expect, it } from 'vitest'

import { parseWorktreeRoots, pickExistingRoot, storeKeyOf } from './repository-scope.ts'

/** 一份正常的两条 worktree 输出：主 worktree 在前。 */
const TWO_WORKTREES = [
  'worktree /repo',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree /repo-feature',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/feat/7-worktree',
  '',
].join('\n')

describe('worktree 输出解析', () => {
  it('按输出顺序读出主 worktree 与附属 worktree', () => {
    expect(parseWorktreeRoots(TWO_WORKTREES)).toEqual(['/repo', '/repo-feature'])
  })

  it('忽略 detached、locked 等只描述状态的记录行', () => {
    const detached = [
      'worktree /repo',
      'HEAD 1111111111111111111111111111111111111111',
      'detached',
      '',
      'worktree /repo-detached',
      'HEAD 2222222222222222222222222222222222222222',
      'detached',
      'locked',
      '',
    ].join('\n')

    expect(parseWorktreeRoots(detached)).toEqual(['/repo', '/repo-detached'])
  })

  it('只有一条记录时也照常读出', () => {
    expect(parseWorktreeRoots('worktree /solo\nHEAD abc\nbranch refs/heads/main\n')).toEqual([
      '/solo',
    ])
  })

  it('输出损坏或为空时返回空列表', () => {
    expect(parseWorktreeRoots('')).toEqual([])
    expect(parseWorktreeRoots('fatal: not a git repository')).toEqual([])
    expect(parseWorktreeRoots('worktree \n')).toEqual([])
  })

  it('重复的路径只保留一次', () => {
    expect(parseWorktreeRoots('worktree /repo\nworktree /repo\n')).toEqual(['/repo'])
  })

  it('兼容 CRLF 输出', () => {
    expect(parseWorktreeRoots('worktree /repo\r\nworktree /repo-feature\r\n')).toEqual([
      '/repo',
      '/repo-feature',
    ])
  })
})

describe('作用域选择', () => {
  const roots = ['/repo', '/repo-feature'] as const

  it('主 worktree 存在时取它', async () => {
    await expect(pickExistingRoot(roots, () => true)).resolves.toBe('/repo')
  })

  it('主 worktree 目录被删掉时取下一个存在的', async () => {
    await expect(pickExistingRoot(roots, (path) => path !== '/repo')).resolves.toBe('/repo-feature')
    await expect(pickExistingRoot(roots, async () => true)).resolves.toBe('/repo')
  })

  it('一条都不存在时不猜', async () => {
    await expect(pickExistingRoot(roots, () => false)).resolves.toBeUndefined()
    await expect(pickExistingRoot([], () => true)).resolves.toBeUndefined()
  })
})

describe('缓存键', () => {
  it('托管后端按仓库作用域归并', () => {
    expect(storeKeyOf('github', '/repo', '/repo-feature')).toBe('/repo')
    expect(storeKeyOf('gitlab', '/repo', '/repo-feature')).toBe('/repo')
    expect(storeKeyOf('gitea', '/repo', '/repo-feature')).toBe('/repo')
  })

  it('本地 Markdown 按工作区隔离', () => {
    expect(storeKeyOf('markdown', '/repo', '/repo-feature')).toBe('/repo-feature')
  })
})
