/**
 * GitLab 详情里的上传附件：正文与评论都要内联成 data URL，
 * 取图失败时退化成指向 GitLab 原链接的普通链接。
 */
import { describe, expect, it } from 'vitest'

import type { BinaryCommandRunner, CommandRunner } from '../../core/ticket.ts'
import { CommandError } from '../../core/tracker-error.ts'
import { GITLAB_REMOTES_OUTPUT, gitlabIssueDetail, gitlabNote } from './fixtures.ts'
import { createGitlabTracker } from './tracker.ts'

const PROJECT_ENDPOINT = 'projects/cnzgray%2Fplatform%2Fdsh-workflow'
const UPLOAD_PATH = '/uploads/abc123def456/%E5%B7%A5%E8%B5%84%E6%98%8E%E7%BB%86.png'
const API_ENDPOINT = `${PROJECT_ENDPOINT}/uploads/abc123def456/%E5%B7%A5%E8%B5%84%E6%98%8E%E7%BB%86.png`
const FALLBACK_URL = `https://gitlab.com/cnzgray/platform/dsh-workflow${UPLOAD_PATH}`

/** 只够识别 PNG 的签名；测试不解析像素。 */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const BODY = `## 目标\n\n![工资明细](/uploads/abc123def456/工资明细.png)`
const COMMENT = `看图：![工资明细](/uploads/abc123def456/工资明细.png)`

function stringRunner(options: {
  readonly description: string
  readonly notes: readonly unknown[]
}): CommandRunner {
  return (command, args) => {
    const endpoint = args[1] ?? ''
    if (command === 'git') return Promise.resolve({ stdout: GITLAB_REMOTES_OUTPUT, stderr: '' })
    if (endpoint === `${PROJECT_ENDPOINT}/issues/15`) {
      return Promise.resolve({
        stdout: JSON.stringify(
          gitlabIssueDetail({ iid: 15, title: '附件显示', description: options.description }),
        ),
        stderr: '',
      })
    }
    if (endpoint.includes('/notes?')) {
      return Promise.resolve({ stdout: JSON.stringify(options.notes), stderr: '' })
    }
    return Promise.reject(new CommandError('failed', 'unexpected', endpoint, 1))
  }
}

function notes(): unknown[] {
  return [
    gitlabNote({ username: 'bob', body: COMMENT, createdAt: '2026-11-13T09:00:00Z' }),
  ]
}

function trackedBinary(handler?: () => Promise<Uint8Array>): {
  readonly run: BinaryCommandRunner
  readonly calls: string[][]
} {
  const calls: string[][] = []
  const run: BinaryCommandRunner = async (command, args) => {
    calls.push([command, ...args])
    const bytes = handler === undefined ? PNG : await handler()
    return { stdout: bytes, stderr: '' }
  }
  return { run, calls }
}

describe('GitLab 详情内联上传附件', () => {
  it('正文与评论里的 /uploads 图片都内联成 data URL，同一张图只取一次', async () => {
    const binary = trackedBinary()
    const tracker = createGitlabTracker({
      run: stringRunner({ description: BODY, notes: notes() }),
      now: () => 1_700_000_000_000,
      runBinary: binary.run,
    })

    const detail = await tracker.fetchDetail?.('/workspace', { ref: '#15', number: 15 })

    expect(detail?.body).toContain('![工资明细](data:image/png;base64,')
    expect(detail?.comments[0]?.body).toContain('看图：![工资明细](data:image/png;base64,')
    expect(detail?.comments[0]?.body).not.toContain('/uploads/abc123def456')
    const encoded = /![^\]]*\]\(data:image\/png;base64,([A-Za-z0-9+/=]+)\)/.exec(
      detail?.body ?? '',
    )?.[1]
    expect(Buffer.from(encoded ?? '', 'base64')).toEqual(Buffer.from(PNG))

    // glab 自己注入 token：参数里只有接口路径，结果里只有图片字节。
    expect(binary.calls).toEqual([['glab', 'api', API_ENDPOINT]])
    expect(JSON.stringify(binary.calls)).not.toMatch(/token|glpat|PRIVATE-TOKEN/i)
    expect(detail?.body).not.toContain('/uploads/abc123def456')
  })

  it('取图失败时降级为文件名加 GitLab 原链接，不影响详情本身', async () => {
    const binary = trackedBinary(() =>
      Promise.reject(new CommandError('failed', 'glab 退出码 1', 'glab: 404 Not Found', 1)),
    )
    const tracker = createGitlabTracker({
      run: stringRunner({ description: BODY, notes: notes() }),
      now: () => 1_700_000_000_000,
      runBinary: binary.run,
    })

    const detail = await tracker.fetchDetail?.('/workspace', { ref: '#15', number: 15 })

    expect(detail?.body).toContain(`[工资明细](${FALLBACK_URL})`)
    expect(detail?.comments.map((comment) => comment.body)).toEqual([
      `看图：[工资明细](${FALLBACK_URL})`,
    ])
  })

  it('没有二进制执行器时不改正文，保持旧行为', async () => {
    const tracker = createGitlabTracker({
      run: stringRunner({ description: BODY, notes: notes() }),
      now: () => 1_700_000_000_000,
    })

    const detail = await tracker.fetchDetail?.('/workspace', { ref: '#15', number: 15 })

    expect(detail?.body).toBe(BODY)
    expect(detail?.comments.map((comment) => comment.body)).toEqual([COMMENT])
  })
})
