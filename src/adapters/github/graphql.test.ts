import { describe, expect, it } from 'vitest'

import { TrackerError } from '../../core/tracker-error.ts'
import {
  GH_CHANGES_OUTPUT,
  GH_ISSUE_DETAIL,
  GH_ISSUES_OUTPUT,
  GH_ISSUES_PAGED_OUTPUT,
  GH_TRUNCATED_CHANGES_OUTPUT,
  ghAuthor,
} from './fixtures.ts'
import {
  parseIssueChangesGraphql,
  parseIssueCore,
  parseIssueDetailPage,
  parseIssueGraphql,
} from './graphql.ts'

describe('GraphQL 工单解析', () => {
  it('解析总数与每张票的字段', () => {
    const parsed = parseIssueGraphql(GH_ISSUES_OUTPUT)

    expect(parsed.total).toBe(30)
    expect(parsed.tickets).toHaveLength(5)
    expect(parsed.tickets[0]).toEqual({
      ref: '#15',
      number: 15,
      title: '右侧栏任务面板 MVP',
      state: 'open',
      labels: ['enhancement', 'ready-for-agent'],
      author: {
        login: 'cnzgray',
        displayName: 'Cnzgray',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1234?v=4',
      },
      assignees: ['cnzgray'],
      createdAt: '2026-11-12T14:11:22Z',
      updatedAt: '2026-11-12T14:11:38Z',
      openBlockers: 0,
    })
  })

  it('列表解析工单链接，字段缺失时省略', () => {
    const payload = JSON.parse(GH_ISSUES_OUTPUT) as {
      data: { repository: { issues: { nodes: Record<string, unknown>[] } } }
    }
    const url = 'https://github.com/cnzgray/dsh-mattpocock-workflow/issues/15'
    const node = payload.data.repository.issues.nodes[0]
    if (node === undefined) throw new Error('录制快照缺少第一张票')
    node.url = url

    const parsed = parseIssueGraphql(JSON.stringify(payload))

    expect(parsed.tickets[0]?.url).toBe(url)
    expect(parseIssueGraphql(GH_ISSUES_OUTPUT).tickets[0]?.url).toBeUndefined()
  })

  it('把阻塞汇总映射成未关闭阻塞数', () => {
    const parsed = parseIssueGraphql(GH_ISSUES_OUTPUT)

    expect(parsed.tickets.find((ticket) => ticket.number === 16)?.openBlockers).toBe(1)
    expect(parsed.tickets.find((ticket) => ticket.number === 7)?.openBlockers).toBe(2)
  })

  it('同仓库父票存 #编号，跨仓库父票存完整引用', () => {
    const parsed = parseIssueGraphql(GH_ISSUES_OUTPUT)
    const parents = new Map(parsed.tickets.map((ticket) => [ticket.ref, ticket.parent]))

    expect(parents.get('#16')).toBe('#15')
    expect(parents.get('#12')).toBe('someone/other#42')
    expect(parents.get('#15')).toBeUndefined()
    expect(parents.get('#9')).toBeUndefined()
    expect(parents.get('#7')).toBeUndefined()
  })

  it('父票仓库不可见时按无父级处理', () => {
    const output = JSON.stringify({
      data: {
        repository: {
          nameWithOwner: 'cnzgray/repo',
          issues: {
            totalCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 1,
                title: '父票不可见',
                state: 'OPEN',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
                labels: { nodes: [] },
                parent: { number: 15, repository: null },
              },
            ],
          },
        },
      },
    })

    expect(parseIssueGraphql(output).tickets[0]?.parent).toBeUndefined()
  })

  it('缺少依赖汇总时按 0 处理', () => {
    const output = JSON.stringify({
      data: {
        repository: {
          issues: {
            totalCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 1,
                title: '没有依赖',
                state: 'OPEN',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
                labels: { nodes: [] },
              },
            ],
          },
        },
      },
    })

    expect(parseIssueGraphql(output).tickets[0]?.openBlockers).toBe(0)
  })

  it('缺少创建人时整张票仍然可用，创建人为 null', () => {
    const output = JSON.stringify({
      data: {
        repository: {
          issues: {
            totalCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 1,
                title: '没有创建人',
                state: 'OPEN',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
                labels: { nodes: [] },
                author: null,
              },
            ],
          },
        },
      },
    })

    expect(parseIssueGraphql(output).tickets[0]?.author).toBeNull()
  })

  it('读取下一页游标；没有下一页时不给游标', () => {
    expect(parseIssueGraphql(GH_ISSUES_OUTPUT).nextCursor).toBeUndefined()
    expect(parseIssueGraphql(GH_ISSUES_PAGED_OUTPUT).nextCursor).toBe('Y3Vyc29yOnYyOpHOF0')
  })

  it('缺少分页信息时返回数据格式错误，不静默当成已覆盖全部', () => {
    const output = JSON.stringify({
      data: {
        repository: {
          issues: {
            totalCount: 1,
            nodes: [],
          },
        },
      },
    })

    expect(() => parseIssueGraphql(output)).toThrow(/pageInfo/)
  })

  it('还有下一页却没有游标时返回数据格式错误', () => {
    const output = JSON.stringify({
      data: {
        repository: {
          issues: {
            totalCount: 30,
            pageInfo: { hasNextPage: true, endCursor: null },
            nodes: [],
          },
        },
      },
    })

    expect(() => parseIssueGraphql(output)).toThrow(/endCursor/)
  })

  it('输出不是 JSON 时返回抓取失败', () => {
    expect(() => parseIssueGraphql('not json')).toThrow(TrackerError)
  })

  it('仓库不存在时返回抓取失败', () => {
    expect(() => parseIssueGraphql(JSON.stringify({ data: { repository: null } }))).toThrow(
      /找不到这个仓库/,
    )
  })

  it('缺少 totalCount 时返回数据格式错误，而不是静默当成已加载数', () => {
    const output = JSON.stringify({
      data: { repository: { issues: { nodes: [] } } },
    })

    expect(() => parseIssueGraphql(output)).toThrow(/totalCount/)
  })

  it('状态不是 open/closed 时返回数据格式错误', () => {
    const output = JSON.stringify({
      data: {
        repository: {
          issues: {
            totalCount: 1,
            nodes: [
              {
                number: 1,
                title: '状态坏了',
                state: 'MERGED',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              },
            ],
          },
        },
      },
    })

    expect(() => parseIssueGraphql(output)).toThrow(/状态不合法/)
  })

  it('阻塞数不是非负数时返回数据格式错误', () => {
    const output = JSON.stringify({
      data: {
        repository: {
          issues: {
            totalCount: 1,
            nodes: [
              {
                number: 1,
                title: '阻塞数坏了',
                state: 'OPEN',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
                issueDependenciesSummary: { blockedBy: -1 },
              },
            ],
          },
        },
      },
    })

    expect(() => parseIssueGraphql(output)).toThrow(/blockedBy/)
  })
})

describe('GraphQL 详情解析', () => {
  it('解析作者、分配人与评论作者的头像', () => {
    const page = parseIssueDetailPage(GH_ISSUE_DETAIL)

    expect(page.author).toEqual(ghAuthor('dave'))
    expect(page.assignees).toEqual([ghAuthor('alice')])
    expect(page.comments.map((comment) => comment.author)).toEqual([
      ghAuthor('bob'),
      ghAuthor('carol'),
    ])
    expect(page.hasNextPage).toBe(false)
  })

  it('工单不存在时返回 ticket-not-found', () => {
    const output = JSON.stringify({ data: { repository: { issue: null } } })

    expect(() => parseIssueDetailPage(output)).toThrow(
      expect.objectContaining({ code: 'ticket-not-found' }) as Error,
    )
  })

  it('只取当前值时忽略评论字段', () => {
    const core = parseIssueCore(GH_ISSUE_DETAIL)

    expect(core.assignees).toEqual([ghAuthor('alice')])
    expect(core).not.toHaveProperty('comments')
  })
})

describe('GraphQL 人员信息解析', () => {
  it('同一次响应里读出当前用户与每张票的分配人登录名', () => {
    const parsed = parseIssueGraphql(GH_ISSUES_OUTPUT)

    expect(parsed.viewer).toBe('cnzgray')
    expect(parsed.tickets.find((ticket) => ticket.number === 15)?.assignees).toEqual(['cnzgray'])
    expect(parsed.tickets.find((ticket) => ticket.number === 16)?.assignees).toEqual([
      'alice',
      'bob',
    ])
  })

  it('缺少 viewer 时按没有身份处理，列表仍然可用', () => {
    const output = JSON.stringify({
      data: {
        repository: {
          issues: {
            totalCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 1,
                title: '没有身份',
                state: 'OPEN',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
                labels: { nodes: [] },
              },
            ],
          },
        },
      },
    })

    const parsed = parseIssueGraphql(output)

    expect(parsed.viewer).toBeNull()
    expect(parsed.tickets).toHaveLength(1)
  })

  it('缺少 assignees 或条目形状不对时跳过该条目，按空数组处理', () => {
    const output = JSON.stringify({
      data: {
        viewer: { login: 'cnzgray' },
        repository: {
          issues: {
            totalCount: 2,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 1,
                title: '没有分配人',
                state: 'OPEN',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
                labels: { nodes: [] },
              },
              {
                number: 2,
                title: '脏分配人',
                state: 'OPEN',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
                labels: { nodes: [] },
                assignees: { nodes: [null, { login: '' }, { login: 'carol' }] },
              },
            ],
          },
        },
      },
    })

    const parsed = parseIssueGraphql(output)

    expect(parsed.tickets[0]?.assignees).toEqual([])
    expect(parsed.tickets[1]?.assignees).toEqual(['carol'])
  })

  it('增量响应也带当前用户', () => {
    expect(parseIssueChangesGraphql(GH_CHANGES_OUTPUT).viewer).toBe('cnzgray')
  })
})

describe('GraphQL 增量解析', () => {
  it('解析窗口内变更过的工单与仓库总数', () => {
    const parsed = parseIssueChangesGraphql(GH_CHANGES_OUTPUT)

    expect(parsed.tickets.map((ticket) => ticket.ref)).toEqual(['#16', '#12'])
    expect(parsed.truncated).toBe(false)
    expect(parsed.total).toBe(30)
  })

  it('后端还有下一页时标记为截断', () => {
    expect(parseIssueChangesGraphql(GH_TRUNCATED_CHANGES_OUTPUT).truncated).toBe(true)
  })

  it('拿不到分页信息时按可能不完整处理，让宿主退回全量重拉', () => {
    const output = JSON.stringify({ data: { repository: { issues: { nodes: [] } } } })

    expect(parseIssueChangesGraphql(output).truncated).toBe(true)
  })

  it('仓库总数给不出时不报总数，宿主沿用上次的', () => {
    const output = JSON.stringify({
      data: { repository: { issues: { pageInfo: { hasNextPage: false }, nodes: [] } } },
    })

    expect(parseIssueChangesGraphql(output).total).toBeUndefined()
  })

  it('输出不是 JSON 时返回抓取失败', () => {
    expect(() => parseIssueChangesGraphql('not json')).toThrow(TrackerError)
  })
})
