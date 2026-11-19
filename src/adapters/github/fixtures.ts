/**
 * 录制自 gh 2.102 的固定输出，测试不连网络。
 * 覆盖可接、阻塞、其他开放、已关闭四类，以及 bug/enhancement 两种分类。
 */

export const GIT_REMOTES_OUTPUT = [
  'origin\tgit@github.com:cnzgray/dsh-mattpocock-workflow.git (fetch)',
  'origin\tgit@github.com:cnzgray/dsh-mattpocock-workflow.git (push)',
].join('\n')

const AUTHOR = {
  login: 'cnzgray',
  name: 'Cnzgray',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1234?v=4',
}

const RECORDED_ISSUES = {
  data: {
    viewer: { login: 'cnzgray' },
    repository: {
      nameWithOwner: 'cnzgray/dsh-mattpocock-workflow',
      issues: {
        totalCount: 30,
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            number: 15,
            title: '右侧栏任务面板 MVP',
            state: 'OPEN',
            createdAt: '2026-11-12T14:11:22Z',
            updatedAt: '2026-11-12T14:11:38Z',
            labels: { nodes: [{ name: 'enhancement' }, { name: 'ready-for-agent' }] },
            author: AUTHOR,
            assignees: { nodes: [{ login: 'cnzgray' }] },
            issueDependenciesSummary: { blockedBy: 0 },
          },
          {
            number: 16,
            title: '工单后端新增 Gitea 支持',
            state: 'OPEN',
            createdAt: '2026-11-12T14:14:07Z',
            updatedAt: '2026-11-12T14:14:19Z',
            labels: { nodes: [{ name: 'enhancement' }, { name: 'ready-for-agent' }] },
            author: AUTHOR,
            assignees: { nodes: [{ login: 'alice' }, { login: 'bob' }] },
            issueDependenciesSummary: { blockedBy: 1 },
            parent: {
              number: 15,
              repository: { nameWithOwner: 'cnzgray/dsh-mattpocock-workflow' },
            },
          },
          {
            number: 12,
            title: '刷新后列表没有回到顶部',
            state: 'OPEN',
            createdAt: '2026-11-11T09:00:00Z',
            updatedAt: '2026-11-12T08:00:00Z',
            labels: { nodes: [{ name: 'bug' }] },
            author: AUTHOR,
            issueDependenciesSummary: { blockedBy: 0 },
            parent: { number: 42, repository: { nameWithOwner: 'someone/other' } },
          },
          {
            number: 9,
            title: '整理术语表',
            state: 'OPEN',
            createdAt: '2026-11-10T09:00:00Z',
            updatedAt: '2026-11-10T09:30:00Z',
            labels: { nodes: [{ name: 'needs-triage' }] },
            author: AUTHOR,
            issueDependenciesSummary: { blockedBy: 0 },
            parent: null,
          },
          {
            number: 7,
            title: '初始化工程',
            state: 'CLOSED',
            createdAt: '2026-11-01T09:00:00Z',
            updatedAt: '2026-11-02T09:00:00Z',
            closedAt: '2026-11-02T09:30:00Z',
            labels: { nodes: [{ name: 'bug' }, { name: 'ready-for-agent' }] },
            author: AUTHOR,
            issueDependenciesSummary: { blockedBy: 2 },
          },
        ],
      },
    },
  },
}

export const GH_ISSUES_OUTPUT = JSON.stringify(RECORDED_ISSUES, null, 2)

/** 列表还有下一页的录制输出：`hasNextPage` 为真并带下一页游标。 */
export const GH_ISSUES_PAGED_OUTPUT = JSON.stringify(
  {
    data: {
      viewer: { login: 'cnzgray' },
      repository: {
        issues: {
          totalCount: 30,
          pageInfo: { hasNextPage: true, endCursor: 'Y3Vyc29yOnYyOpHOF0' },
          nodes: [
            {
              number: 5,
              title: '第二页的一张票',
              state: 'OPEN',
              createdAt: '2026-11-05T09:00:00Z',
              updatedAt: '2026-11-05T09:30:00Z',
              labels: { nodes: [{ name: 'needs-triage' }] },
              author: AUTHOR,
              issueDependenciesSummary: { blockedBy: 0 },
            },
            {
              number: 3,
              title: '第二页的另一张票',
              state: 'CLOSED',
              createdAt: '2026-11-03T09:00:00Z',
              updatedAt: '2026-11-03T09:30:00Z',
              closedAt: '2026-11-03T10:00:00Z',
              labels: { nodes: [] },
              author: AUTHOR,
              issueDependenciesSummary: { blockedBy: 0 },
            },
          ],
        },
      },
    },
  },
  null,
  2,
)

/**
 * 增量查询的录制输出：同一份查询加上更新时间过滤后只回变更过的票。
 *
 * `repositoryTotal` 是未过滤的仓库总数：带过滤的 `totalCount` 只是
 * 「这次窗口内变更了多少张票」，不能当仓库总数用。
 */
export const GH_CHANGES_OUTPUT = JSON.stringify(
  {
    data: {
      viewer: { login: 'cnzgray' },
      repository: {
        nameWithOwner: 'cnzgray/dsh-mattpocock-workflow',
        repositoryTotal: { totalCount: 30 },
        latest: {
          totalCount: 30,
          nodes: [{ updatedAt: '2027-01-01T00:00:00Z' }],
        },
        issues: {
          pageInfo: { hasNextPage: false },
          nodes: [
            {
              number: 16,
              title: '工单后端新增 Gitea 支持',
              state: 'OPEN',
              createdAt: '2026-11-12T14:14:07Z',
              updatedAt: '2026-11-13T09:00:00Z',
              labels: { nodes: [{ name: 'enhancement' }, { name: 'ready-for-agent' }] },
              author: AUTHOR,
              issueDependenciesSummary: { blockedBy: 1 },
              parent: {
                number: 15,
                repository: { nameWithOwner: 'cnzgray/dsh-mattpocock-workflow' },
              },
            },
            {
              number: 12,
              title: '刷新后列表没有回到顶部',
              state: 'CLOSED',
              createdAt: '2026-11-11T09:00:00Z',
              updatedAt: '2026-11-13T08:00:00Z',
              closedAt: '2026-11-13T08:30:00Z',
              labels: { nodes: [{ name: 'bug' }] },
              author: AUTHOR,
              issueDependenciesSummary: { blockedBy: 0 },
              parent: { number: 42, repository: { nameWithOwner: 'someone/other' } },
            },
          ],
        },
      },
    },
  },
  null,
  2,
)

/** 增量查询被单页上限截断的录制输出：`hasNextPage` 为真。 */
export const GH_TRUNCATED_CHANGES_OUTPUT = JSON.stringify({
  data: {
    viewer: { login: 'cnzgray' },
    repository: {
      repositoryTotal: { totalCount: 30 },
      issues: {
        pageInfo: { hasNextPage: true },
        nodes: [],
      },
    },
  },
})

/** 只看远端版本的极小查询：总数与最新更新时间。 */
export const GH_REVISION_OUTPUT = JSON.stringify({
  data: {
    repository: {
      nameWithOwner: 'cnzgray/dsh-mattpocock-workflow',
      latest: {
        totalCount: 30,
        nodes: [{ updatedAt: '2027-01-01T00:00:00Z' }],
      },
    },
  },
})

/** 录制里出现的 GitHub 用户：名字与头像 id 固定，期望值可以按登录名推导。 */
const GITHUB_USERS: Readonly<Record<string, { readonly name: string | null; readonly id: number }>> =
  {
    dave: { name: 'Dave', id: 4004 },
    alice: { name: 'Alice', id: 4001 },
    bob: { name: null, id: 4002 },
    carol: { name: null, id: 4003 },
  }

function userAvatarUrl(login: string): string {
  const id = GITHUB_USERS[login]?.id ?? 4000
  return `https://avatars.githubusercontent.com/u/${String(id)}?v=4`
}

/** GraphQL 用户对象；`name` 为空时显示名按 null 处理。 */
export function ghUserNode(login: string): Record<string, unknown> {
  return { login, name: GITHUB_USERS[login]?.name ?? null, avatarUrl: userAvatarUrl(login) }
}

/** 期望的创建人 / 评论作者 / 分配人。 */
export function ghAuthor(login: string): {
  readonly login: string
  readonly displayName: string | null
  readonly avatarUrl: string
} {
  return { login, displayName: GITHUB_USERS[login]?.name ?? null, avatarUrl: userAvatarUrl(login) }
}

/** 构造 GraphQL 详情查询里的 issue 对象。 */
export function ghIssueDetailNode(overrides: {
  readonly number: number
  readonly title: string
  readonly body?: string
  readonly state?: 'OPEN' | 'CLOSED'
  readonly author?: string | null
  readonly labels?: readonly string[]
  readonly assignees?: readonly string[]
  readonly comments?: readonly {
    readonly author: string | null
    readonly body: string
    readonly createdAt: string
  }[]
  readonly url?: string
  readonly createdAt?: string
  readonly updatedAt?: string
  /** 评论还有下一页时为 true；配合 `endCursor` 验证翻页。 */
  readonly hasNextPage?: boolean
  readonly endCursor?: string | null
}): Record<string, unknown> {
  return {
    number: overrides.number,
    title: overrides.title,
    body: overrides.body ?? '',
    state: overrides.state ?? 'OPEN',
    author: overrides.author === null ? null : ghUserNode(overrides.author ?? 'dave'),
    labels: { nodes: (overrides.labels ?? []).map((name) => ({ name })) },
    assignees: { nodes: (overrides.assignees ?? []).map((login) => ghUserNode(login)) },
    comments: {
      pageInfo: {
        hasNextPage: overrides.hasNextPage ?? false,
        endCursor: overrides.endCursor ?? null,
      },
      nodes: (overrides.comments ?? []).map((comment) => ({
        author: comment.author === null ? null : ghUserNode(comment.author),
        body: comment.body,
        createdAt: comment.createdAt,
      })),
    },
    url: overrides.url ?? '',
    createdAt: overrides.createdAt ?? '2026-11-12T14:11:22Z',
    updatedAt: overrides.updatedAt ?? '2026-11-13T10:00:00Z',
  }
}

/** 构造一次 `gh api graphql` 详情查询的完整响应。 */
export function ghDetailOutput(issue: Record<string, unknown>): string {
  return JSON.stringify({ data: { repository: { issue } } })
}

/** 详情查询的录制输出：作者、分配人与评论作者都带头像。 */
export const GH_ISSUE_DETAIL = ghDetailOutput(
  ghIssueDetailNode({
    number: 15,
    title: '右侧栏任务面板 MVP',
    body: '## 目标\n\n在面板里看工单。',
    labels: ['enhancement', 'ready-for-agent'],
    assignees: ['alice'],
    comments: [
      { author: 'bob', body: '补充验收标准', createdAt: '2026-11-13T09:00:00Z' },
      { author: 'carol', body: '上一次失败的原因', createdAt: '2026-11-13T10:00:00Z' },
    ],
    url: 'https://github.com/cnzgray/dsh-mattpocock-workflow/issues/15',
  }),
)

/** `gh label list --json name,color,description` 的录制输出。 */
export const GH_LABELS_OUTPUT = JSON.stringify([
  { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
  { name: 'enhancement', color: 'A2EEEF', description: '' },
  { name: 'needs-triage', color: '', description: '需要分诊' },
])

/** `gh api repos/<owner>/<name>/assignees --paginate --slurp` 的录制输出：页的数组。 */
export const GH_ASSIGNEES_OUTPUT = JSON.stringify([
  [
    { login: 'alice', id: 1 },
    { login: 'bob', id: 2 },
  ],
  [
    { login: 'carol', id: 3 },
    { login: 'alice', id: 1 },
  ],
])

/** `gh repo view --json viewerPermission` 的录制输出：仓库管理员。 */
export const GH_VIEWER_PERMISSION_OUTPUT = JSON.stringify({ viewerPermission: 'ADMIN' })
