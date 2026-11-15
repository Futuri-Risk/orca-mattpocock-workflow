/**
 * GitHub 工单详情与变更：详情整条走 `gh api graphql`，与列表共用同一套用户字段与解析规则；
 * 评论按 `pageInfo.hasNextPage` 自己翻页。`gh issue edit` 落地标签与分配人，
 * `gh issue close` / `reopen` 落地状态。
 *
 * 为什么不用 `gh issue view --json`：它的用户对象只有 id / is_bot / login / name，
 * 拿不到头像地址；GraphQL 一次就能把作者、分配人与评论作者的头像取全。
 *
 * 补丁表达目标集合；这里用 core 的 {@link planSetChange} 与当前值算成
 * `--add-label` / `--remove-label` 这类增量参数。变更前只读当前值，不拉评论。
 */
import {
  isEmptyDiff,
  planSetChange,
  requireTicketNumber,
  sortCommentsByTime,
  type SetDiff,
} from '../../core/ticket-detail.ts'
import type {
  CommandRunner,
  TicketComment,
  TicketDetail,
  TicketPatch,
  TicketReference,
} from '../../core/ticket.ts'
import { CommandError, TrackerError } from '../../core/tracker-error.ts'
import {
  GITHUB_USER_FIELDS,
  parseIssueCore,
  parseIssueDetailPage,
  type ParsedDetailPage,
  type ParsedIssueCore,
} from './graphql.ts'
import { callGh, readRepository, repositoryLabel, type GithubRepository } from './shared.ts'

/** 单页评论上限；GitHub 的连接上限同样是 100。 */
const COMMENT_PAGE_SIZE = 100

const NOT_FOUND = /Could not resolve to an Issue/i

/** 详情与变更前读取当前值共用的工单字段。 */
const ISSUE_CORE_FIELDS = `number
        title
        body
        state
        url
        createdAt
        updatedAt
        labels(first: 50) { nodes { name } }
        author { ${GITHUB_USER_FIELDS} }
        assignees(first: 20) { nodes { ${GITHUB_USER_FIELDS} } }`

const DETAIL_QUERY = `query ($owner: String!, $name: String!, $number: Int!, $comments: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      ${ISSUE_CORE_FIELDS}
      comments(first: $comments, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { body createdAt author { ${GITHUB_USER_FIELDS} } }
      }
    }
  }
}`

const CURRENT_QUERY = `query ($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      ${ISSUE_CORE_FIELDS}
    }
  }
}`

/** 详情读取与变更共用的依赖。 */
export interface GithubDetailDeps {
  readonly run: CommandRunner
}

/**
 * 读取一张 GitHub 工单的详情。
 * @param deps - 命令执行器。
 * @param workspaceRoot - 工作区根目录，用于识别仓库。
 * @param reference - 工单引用；必须有数字编号。
 * @returns 详情。
 * @throws {TrackerError} 编号不存在、命令失败或输出格式不合法。
 */
export async function readGithubDetail(
  deps: GithubDetailDeps,
  workspaceRoot: string,
  reference: TicketReference,
): Promise<TicketDetail> {
  const repository = await readRepository(deps.run, workspaceRoot)
  return readDetailWithRepository(deps, workspaceRoot, repository, reference)
}

async function readDetailWithRepository(
  deps: GithubDetailDeps,
  workspaceRoot: string,
  repository: GithubRepository,
  reference: TicketReference,
): Promise<TicketDetail> {
  const number = requireTicketNumber(reference)
  const first = parseIssueDetailPage(
    await callGhDetail(deps.run, workspaceRoot, detailArgs(repository, number, null)),
  )

  const comments: TicketComment[] = [...first.comments]
  let cursor = first.endCursor
  let hasNextPage = first.hasNextPage

  while (hasNextPage) {
    // 分页游标不前进时停下：再请求一次也只会拿到同一页。
    if (cursor === null) {
      throw new TrackerError('fetch-failed', 'GitHub 评论分页缺少游标，已停止读取。')
    }
    const next = parseIssueDetailPage(
      await callGhDetail(deps.run, workspaceRoot, detailArgs(repository, number, cursor)),
    )
    comments.push(...next.comments)
    if (next.hasNextPage && next.endCursor === cursor) {
      throw new TrackerError('fetch-failed', 'GitHub 评论分页游标没有前进，已停止读取。')
    }
    cursor = next.endCursor
    hasNextPage = next.hasNextPage
  }

  return { ...detailOf(first, reference), comments: sortCommentsByTime(comments) }
}

/**
 * 应用一次变更补丁：先读当前值算出差异，再按各自语义发命令。
 * @param deps - 命令执行器。
 * @param workspaceRoot - 工作区根目录。
 * @param reference - 工单引用；必须有数字编号。
 * @param patch - 目标集合与目标状态。
 * @throws {TrackerError} 命令失败；已成功的前置命令不会回滚。
 */
export async function applyGithubChanges(
  deps: GithubDetailDeps,
  workspaceRoot: string,
  reference: TicketReference,
  patch: TicketPatch,
): Promise<void> {
  const number = requireTicketNumber(reference)
  const repository = await readRepository(deps.run, workspaceRoot)
  const repoArgs = ['--repo', repositoryLabel(repository)]
  const current = await readCurrentValues(deps, workspaceRoot, repository, reference)

  if (patch.labels !== undefined) {
    const diff = planSetChange(current.labels, patch.labels)
    await editIssue(deps.run, workspaceRoot, number, repoArgs, [
      ...diff.add.flatMap((label) => ['--add-label', label]),
      ...diff.remove.flatMap((label) => ['--remove-label', label]),
    ])
  }

  const assignees = assigneeChange(
    current.assignees.map((user) => user.login),
    patch,
  )
  if (!isEmptyDiff(assignees)) {
    await editIssue(deps.run, workspaceRoot, number, repoArgs, [
      ...assignees.add.flatMap((login) => ['--add-assignee', login]),
      ...assignees.remove.flatMap((login) => ['--remove-assignee', login]),
    ])
  }

  if (patch.state !== undefined && patch.state !== current.state) {
    const command = patch.state === 'closed' ? 'close' : 'reopen'
    await callGhDetail(deps.run, workspaceRoot, ['issue', command, String(number), ...repoArgs])
  }
}

async function readCurrentValues(
  deps: GithubDetailDeps,
  workspaceRoot: string,
  repository: GithubRepository,
  reference: TicketReference,
): Promise<ParsedIssueCore> {
  const number = requireTicketNumber(reference)
  const args = [
    'api',
    'graphql',
    '-f',
    `query=${CURRENT_QUERY}`,
    '-f',
    `owner=${repository.owner}`,
    '-f',
    `name=${repository.name}`,
    '-F',
    `number=${String(number)}`,
  ]
  return parseIssueCore(await callGhDetail(deps.run, workspaceRoot, args))
}

function detailArgs(
  repository: GithubRepository,
  number: number,
  cursor: string | null,
): readonly string[] {
  const args = [
    'api',
    'graphql',
    '-f',
    `query=${DETAIL_QUERY}`,
    '-f',
    `owner=${repository.owner}`,
    '-f',
    `name=${repository.name}`,
    '-F',
    `number=${String(number)}`,
    '-F',
    `comments=${String(COMMENT_PAGE_SIZE)}`,
  ]
  return cursor === null ? args : [...args, '-f', `cursor=${cursor}`]
}

function detailOf(page: ParsedDetailPage, reference: TicketReference): TicketDetail {
  return {
    ref: reference.ref,
    number: page.number,
    title: page.title,
    state: page.state,
    author: page.author,
    body: page.body,
    labels: page.labels,
    assignees: page.assignees,
    comments: [],
    url: page.url,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  }
}

function assigneeChange(current: readonly string[], patch: TicketPatch): SetDiff {
  if (patch.assignees === undefined && patch.assignSelf !== true) {
    return { add: [], remove: [] }
  }
  // GitHub 的编辑命令原生支持 @me，不必先查当前登录用户。
  return planSetChange(current, patch.assignees, patch.assignSelf === true ? '@me' : null)
}

async function editIssue(
  run: CommandRunner,
  workspaceRoot: string,
  number: number,
  repoArgs: readonly string[],
  flags: readonly string[],
): Promise<void> {
  if (flags.length === 0) return
  await callGhDetail(run, workspaceRoot, ['issue', 'edit', String(number), ...flags, ...repoArgs])
}

async function callGhDetail(
  run: CommandRunner,
  workspaceRoot: string,
  args: readonly string[],
): Promise<string> {
  try {
    return await callGh(run, workspaceRoot, args)
  } catch (error) {
    if (
      error instanceof TrackerError &&
      error.cause instanceof CommandError &&
      NOT_FOUND.test(error.cause.stderr)
    ) {
      throw new TrackerError('ticket-not-found', '找不到这张工单，它可能已被删除。', {
        cause: error,
      })
    }
    throw error
  }
}
