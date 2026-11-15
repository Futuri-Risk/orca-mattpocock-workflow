import { describe, expect, it } from 'vitest'

import type { CommandRunner } from '../core/ticket.ts'
import { createBackendResolver } from './backend-resolver.ts'

const NOW = 1_700_000_000_000
const MAIN = '/repo'
const ATTACHED = '/repo-feature'

/** `git remote -v` 的一段正常输出：GitHub 远端不需要探测 glab。 */
const GITHUB_REMOTE = [
  'origin\tgit@github.com:cnzgray/repo.git (fetch)',
  'origin\tgit@github.com:cnzgray/repo.git (push)',
  '',
].join('\n')

describe('后端解析缓存', () => {
  it('同一仓库的多个 worktree 共用一次命令行探测', async () => {
    const commands: string[] = []
    const run: CommandRunner = (command, args) => {
      commands.push(`${command} ${args.join(' ')}`)
      return Promise.resolve({ stdout: GITHUB_REMOTE, stderr: '' })
    }
    const resolve = createBackendResolver({
      run,
      now: () => NOW,
      scope: (workspaceRoot) => Promise.resolve(workspaceRoot === ATTACHED ? MAIN : workspaceRoot),
    })

    const first = await resolve(MAIN)
    const second = await resolve(ATTACHED)

    expect(first.kind).toBe('github')
    expect(second.kind).toBe('github')
    expect(commands).toEqual(['git remote -v'])
    // 复用同一份解析结果：两个 worktree 看到同一个远端地址。
    expect(second.address).toEqual(first.address)
  })

  it('不同仓库各探测一次', async () => {
    const commands: string[] = []
    const run: CommandRunner = (command, args) => {
      commands.push(`${command} ${args.join(' ')}`)
      return Promise.resolve({ stdout: GITHUB_REMOTE, stderr: '' })
    }
    const resolve = createBackendResolver({ run, now: () => NOW })

    await resolve('/repo-a')
    await resolve('/repo-b')

    expect(commands).toEqual(['git remote -v', 'git remote -v'])
  })
})
