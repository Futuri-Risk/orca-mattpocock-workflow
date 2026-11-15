import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { CommandRunner } from '../core/ticket.ts'
import { createRepositoryScopeResolver } from './repository-scope.ts'
import { createCommandRunner } from './subprocess-runner.ts'

const exec = promisify(execFile)

let root = ''
let repo = ''
let attached = ''

beforeEach(async () => {
  // git 会把符号链接解析成真实路径；先解析临时目录，断言才对得上。
  root = await realpath(await mkdtemp(join(tmpdir(), 'mattwf-scope-')))
  repo = join(root, 'repo')
  attached = join(root, 'repo-feature')
  await exec('git', ['init', '-q', repo])
  await exec('git', [
    '-C',
    repo,
    '-c',
    'user.email=test@example.com',
    '-c',
    'user.name=test',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init',
  ])
  await exec('git', ['-C', repo, 'worktree', 'add', '-q', attached, '-b', 'feature'])
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('仓库作用域解析', () => {
  it('附属 worktree 解析到主 worktree 根目录', async () => {
    const scope = createRepositoryScopeResolver({ run: createCommandRunner() })

    await expect(scope(attached)).resolves.toBe(repo)
  })

  it('主 worktree 解析到它自己', async () => {
    const scope = createRepositoryScopeResolver({ run: createCommandRunner() })

    await expect(scope(repo)).resolves.toBe(repo)
  })

  it('主 worktree 目录被删掉时落到还存在的 worktree', async () => {
    const scope = createRepositoryScopeResolver({ run: createCommandRunner() })
    await rm(repo, { recursive: true, force: true })

    await expect(scope(attached)).resolves.toBe(attached)
  })

  it('非 git 目录退回工作区自己', async () => {
    const outside = join(root, 'plain')
    await mkdir(outside)
    const scope = createRepositoryScopeResolver({ run: createCommandRunner() })

    await expect(scope(outside)).resolves.toBe(outside)
  })

  it('解析结果按工作区缓存，一个工作区只跑一次 git', async () => {
    let calls = 0
    const inner = createCommandRunner()
    const run: CommandRunner = (...args) => {
      calls += 1
      return inner(...args)
    }
    const scope = createRepositoryScopeResolver({ run })

    const first = await scope(attached)
    const second = await scope(attached)

    expect(first).toBe(repo)
    expect(second).toBe(repo)
    expect(calls).toBe(1)
  })

  it('解析失败不缓存：瞬时失败后下一次请求能解析到主 worktree', async () => {
    let calls = 0
    const inner = createCommandRunner()
    const run: CommandRunner = (...args) => {
      calls += 1
      return calls === 1 ? Promise.reject(new Error('git 超时')) : inner(...args)
    }
    const scope = createRepositoryScopeResolver({ run })

    const first = await scope(attached)
    const second = await scope(attached)
    const third = await scope(attached)

    expect(first).toBe(attached)
    expect(second).toBe(repo)
    expect(third).toBe(repo)
    // 失败那次之后只再跑一次 git：成功结果照常缓存。
    expect(calls).toBe(2)
  })

  it('输出不可解析时退回工作区自己', async () => {
    const run: CommandRunner = () =>
      Promise.resolve({
        stdout: 'fatal: not a git repository',
        stderr: '',
        executable: 'git',
      })
    const scope = createRepositoryScopeResolver({ run })

    await expect(scope(attached)).resolves.toBe(attached)
  })
})
