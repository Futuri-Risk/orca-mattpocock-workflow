import { describe, expect, it } from 'vitest'

import type { BackendKind } from '../protocol/backend.ts'
import {
  isOrcaReferenceUrl,
  planWorktree,
  worktreeCreateArgs,
} from './worktree.ts'

describe('Orca 能否路由工单链接', () => {
  it.each<readonly [string, BackendKind, string, boolean]>([
    ['GitHub.com issue', 'github', 'https://github.com/acme/repo/issues/6', true],
    ['GitHub.com pull', 'github', 'https://github.com/acme/repo/pull/6', true],
    ['自建 GitHub issue', 'github', 'https://github.example.com/acme/repo/issues/6', false],
    ['自建 GitHub pull', 'github', 'https://github.example.com/acme/repo/pull/6', true],
    ['自建 Gitea issue', 'gitea', 'https://git.example.com/acme/repo/issues/6', false],
    ['自建 Gitea pull', 'gitea', 'https://git.example.com/acme/repo/pulls/6', true],
    ['Codeberg issue', 'gitea', 'https://codeberg.org/acme/repo/issues/6', true],
    ['Codeberg pull 路由与站点不一致', 'github', 'https://codeberg.org/acme/repo/pull/6', false],
    ['www 前缀按公开站点识别', 'github', 'https://www.github.com/acme/repo/issues/6', true],
    ['链接后的子路径不影响识别', 'github', 'https://github.com/acme/repo/issues/6/comments', true],
    ['GitLab 自建 issue', 'gitlab', 'https://gitlab.example.com/group/project/-/issues/6', true],
    ['GitLab 自建 MR', 'gitlab', 'https://gitlab.example.com/group/project/-/merge_requests/6', true],
    ['GitLab.com issue', 'gitlab', 'https://gitlab.com/group/project/-/issues/6', true],
    ['链接路由与后端不一致', 'gitea', 'https://github.com/acme/repo/issues/6', false],
    ['公开站点与链接路由不一致', 'gitea', 'https://bitbucket.org/acme/repo/pulls/6', false],
    ['www.linear.app 的 pull 不当作 GitHub', 'github', 'https://www.linear.app/foo/bar/pull/6', false],
    ['查询串与锚点不影响识别', 'github', 'https://github.com/acme/repo/issues/6?foo=1#note', true],
    ['末尾斜杠不影响识别', 'github', 'https://github.com/acme/repo/issues/6/', true],
    ['编号为零', 'github', 'https://github.com/acme/repo/issues/0', false],
    ['带凭据', 'github', 'https://user:pass@github.com/acme/repo/issues/6', false],
    ['非 HTTP(S)', 'github', 'ftp://github.com/acme/repo/issues/6', false],
    ['不是链接', 'github', 'not a url', false],
  ])('%s', (_label, kind, reference, expected) => {
    expect(isOrcaReferenceUrl(reference, kind)).toBe(expected)
  })
})

describe('worktree 计划', () => {
  it('Orca 能路由时把链接交给 --reference，注释保持原样', () => {
    const plan = planWorktree({
      kind: 'github',
      number: 6,
      title: 'Ticket one',
      category: 'bug',
      reference: 'https://github.com/acme/repo/issues/6',
    })

    expect(plan).toMatchObject({
      branch: 'bugfix/6-ticket-one',
      reference: 'https://github.com/acme/repo/issues/6',
      comment: '#6 Ticket one',
    })
  })

  it('Orca 认不出链接时省略 --reference，把链接补进注释', () => {
    const plan = planWorktree({
      kind: 'gitea',
      number: 23,
      title: '设备作用域',
      category: 'bug',
      reference: 'https://git.xpow.site/xpow/device-scope/issues/23',
    })

    expect(plan).toMatchObject({
      branch: 'bugfix/23',
      reference: null,
      comment: '#23 设备作用域\nhttps://git.xpow.site/xpow/device-scope/issues/23',
    })
  })

  it('没有可挂载链接时参数里不出现 --reference', () => {
    const plan = planWorktree({
      kind: 'gitea',
      number: 23,
      title: '设备作用域',
      category: 'bug',
      reference: 'https://git.xpow.site/xpow/device-scope/issues/23',
    })

    expect(worktreeCreateArgs(plan)).toEqual([
      'worktree',
      'create',
      '--name',
      'bugfix/23',
      '--branch',
      'bugfix/23',
      '--comment',
      '#23 设备作用域\nhttps://git.xpow.site/xpow/device-scope/issues/23',
      '--activate',
      '--json',
    ])
  })
})
