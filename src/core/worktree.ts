/**
 * 为工单创建 Orca worktree 的纯逻辑：分支名与工作区名推导、注释、命令行参数拼装，
 * 以及 Orca `--json` 输出的解析。
 *
 * 这里不做 IO：命令由 worker 用注入的执行器跑，面板只展示结果。
 * 命名规则与仓库里既有的 `feat/4-…`、`bugfix/1-…` 保持一致：
 * 缺陷票用 `bugfix`，其余（含增强与未分类）用 `feat`；工作区名直接复用分支名。
 */
import type { BackendKind } from '../protocol/backend.ts'
import { isRecord } from './json.ts'

/** worktree 创建的时长上限：仓库的 setup hooks 可能跑很久。 */
export const WORKTREE_CREATE_TIMEOUT_MS = 120_000

/** 分支名里 slug 的最大长度，超出部分截断。 */
export const WORKTREE_SLUG_LIMIT = 40

/** Orca 返回的一条 worktree 记录。只保留面板与幂等判断用得到的字段。 */
export interface WorktreeRecord {
  readonly id: string
  readonly path: string
  readonly branch: string
  readonly displayName: string
  /** Orca 的仓库 id；`worktree list --repo id:<repoId>` 用它限定到同一仓库。 */
  readonly repoId: string | null
}

/** 按当前目录认出的工作区；仓库 id 一定存在。 */
export interface CurrentWorktree extends WorktreeRecord {
  readonly repoId: string
}

/** 创建 worktree 所需的命名与引用。 */
export interface WorktreePlan {
  /** Orca 工作区名（侧栏显示名与目录名）；与 `branch` 同值。 */
  readonly name: string
  /** `<类型>/<票号>-<slug>`；slug 为空时为 `<类型>/<票号>`。 */
  readonly branch: string
  /** 交给 `--reference` 的工单链接；Orca 认不出时是 null，链接只进 `comment`。 */
  readonly reference: string | null
  /** `<票号> <标题摘要>`；链接不能挂载时另起一行补上工单链接。 */
  readonly comment: string
}

/** 分支类型的来源：分类标签。 */
export type WorktreeCategory = 'bug' | 'enhancement' | null

/**
 * 从标题推导 slug：小写化 → 非 ASCII 字母数字统一换成连字符 →
 * 连续连字符折叠 → 截断到 40 字符 → 去掉首尾连字符。
 *
 * 中文等非 ASCII 字符不进入 slug，纯中文标题会得到空串。
 * @param title - 工单标题。
 * @returns 可用于分支名的 slug；没有可用字符时是空串。
 */
export function worktreeSlug(title: string): string {
  const collapsed = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, WORKTREE_SLUG_LIMIT)
  return collapsed.replace(/^-+|-+$/g, '')
}

/**
 * 按仓库约定推导分支名。
 * @param number - 工单编号；必须为正整数。
 * @param title - 工单标题。
 * @param category - 分类标签；`bug` 用 `bugfix`，其余用 `feat`。
 * @returns `<类型>/<票号>` 或 `<类型>/<票号>-<slug>`。
 */
export function worktreeBranchName(
  number: number,
  title: string,
  category: WorktreeCategory,
): string {
  const kind = category === 'bug' ? 'bugfix' : 'feat'
  const slug = worktreeSlug(title)
  return slug.length === 0 ? `${kind}/${String(number)}` : `${kind}/${String(number)}-${slug}`
}

/**
 * 标题的单行形式：去掉换行与多余空白。只用于注释，不参与分支名与工作区名。
 * @param title - 工单标题。
 * @returns 单行标题。
 */
export function worktreeDisplayName(title: string): string {
  return title.replace(/\s+/g, ' ').trim()
}

/** Orca 的 URL 路由能认出的 provider；面板后端只用到前三个。 */
type ReferenceProvider =
  | 'github'
  | 'gitlab'
  | 'gitea'
  | 'bitbucket'
  | 'azure-devops'
  | 'linear'

/**
 * Orca 能按公开站点认出的 host 与它的 provider；用于剥掉 `www.` 前缀，
 * 并校验路由是否与站点一致（例如 codeberg.org 的 `/pull/<n>` 会被拒绝）。
 */
const PUBLIC_REFERENCE_HOSTS: Record<string, ReferenceProvider> = {
  'github.com': 'github',
  'gitlab.com': 'gitlab',
  'codeberg.org': 'gitea',
  'bitbucket.org': 'bitbucket',
  'dev.azure.com': 'azure-devops',
  'linear.app': 'linear',
}

/**
 * 判断链接能否直接交给 `orca worktree create --reference`。
 *
 * 面板侧必须按 Orca 的实际路由判定，不能把仓库后端当成提示：Orca 的 CLI 只解析 URL，
 * 自建 GitHub / Gitea 的 `/issues/<n>` 没有可识别的 provider，会被以
 * `invalid_argument: Unsupported reference URL` 拒绝；`/pull/<n>`、`/pulls/<n>`
 * 与 GitLab 的 `/-/issues|merge_requests/<n>` 则能识别。
 * @param reference - 后端详情里的工单链接。
 * @param kind - 当前工单后端；链接路由必须与它一致。
 * @returns Orca 能路由且与后端一致时是 true。
 */
export function isOrcaReferenceUrl(reference: string, kind: BackendKind): boolean {
  if (kind === 'markdown') return false

  let url: URL
  try {
    url = new URL(reference.trim())
  } catch {
    return false
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    return false
  }

  const host = stripWww(url.hostname)
  const pathname = url.pathname.replace(/\/+$/, '')
  return routeProvider(host, pathname) === kind
}

function stripWww(host: string): string {
  const bare = host.startsWith('www.') ? host.slice(4) : host
  return PUBLIC_REFERENCE_HOSTS[bare] === undefined ? host : bare
}

/** 按 Orca 的 URL 路由表认出链接属于哪个后端；认不出时是 null。 */
function routeProvider(host: string, pathname: string): ReferenceProvider | null {
  const known = PUBLIC_REFERENCE_HOSTS[host]

  const gitlab = /^(\/.+)\/-\/(merge_requests|issues)\/(\d+)(?:\/.*)?$/.exec(pathname)
  if (gitlab !== null && host !== 'github.com' && host !== 'linear.app') {
    if (!isPositiveNumber(gitlab[3])) return null
    return known === undefined || known === 'gitlab' ? 'gitlab' : null
  }

  const git = /^(\/[^/]+\/[^/]+)\/(pull|pulls|issues)\/(\d+)(?:\/.*)?$/.exec(pathname)
  if (git === null || host === 'linear.app' || host === 'gitlab.com') return null
  if (!isPositiveNumber(git[3])) return null

  const provider =
    host === 'github.com' || git[2] === 'pull'
      ? 'github'
      : host === 'codeberg.org' || git[2] === 'pulls'
        ? 'gitea'
        : null
  if (provider === null) return null
  if (
    (git[2] === 'pulls' && provider !== 'gitea') ||
    (git[2] === 'pull' && provider !== 'github')
  ) {
    return null
  }
  return known === undefined || known === provider ? provider : null
}

function isPositiveNumber(raw: string | undefined): boolean {
  if (raw === undefined) return false
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0
}

/**
 * 工单摘要在注释里的写法：`<票号> <单行标题>`。
 *
 * 链接不能挂到 Orca 时另起一行补上工单 URL：评论仍可追溯，`--reference` 不会被拒绝。
 * @param ticketRef - 工单引用，例如 `#6`。
 * @param title - 工单标题。
 * @param reference - 无法挂载的工单链接；能挂载或没有链接时省略。
 * @returns 单行或两行注释。
 */
export function worktreeComment(
  ticketRef: string,
  title: string,
  reference?: string | null,
): string {
  const comment = `${ticketRef} ${worktreeDisplayName(title)}`
  const url = reference?.trim() ?? ''
  return url.length === 0 ? comment : `${comment}\n${url}`
}

/**
 * 一次创建的全部命名与引用。
 *
 * 工作区名与分支名取同一个值：工单标题可能很长、含中文或标点，不适合当
 * 目录名与侧栏显示名；标题仍进 `comment`，作为人类可读的摘要。
 * 工单链接只在 Orca 能路由时进入 `reference`，否则连同票号、标题一起写进 `comment`。
 * @param input - 后端类型、编号、标题、分类与后端给出的链接。
 * @returns 可直接拼进命令行的计划。
 */
export function planWorktree(input: {
  readonly kind: BackendKind
  readonly number: number
  readonly title: string
  readonly category: WorktreeCategory
  readonly reference: string
}): WorktreePlan {
  const branch = worktreeBranchName(input.number, input.title, input.category)
  const attachable = isOrcaReferenceUrl(input.reference, input.kind)
  return {
    name: branch,
    branch,
    reference: attachable ? input.reference : null,
    comment: worktreeComment(
      `#${String(input.number)}`,
      input.title,
      attachable ? null : input.reference,
    ),
  }
}

/**
 * `orca worktree create` 的参数。
 *
 * 只用 `--reference` 挂链接，不与 `--issue` / `--pr` / `--gitlab-issue` 混用；
 * 计划里没有可挂载链接（{@link WorktreePlan.reference} 为 null）时省略该参数，
 * 链接已在注释里。不传 `--base-branch`（用仓库默认基线）、不传父工作区参数
 * （由 Orca 按当前目录推断）、不传 `--agent` / `--prompt`（本次只建工作区）。
 * @param plan - 命名与引用。
 * @returns 不含可执行文件的参数列表。
 */
export function worktreeCreateArgs(plan: WorktreePlan): readonly string[] {
  return [
    'worktree',
    'create',
    '--name',
    plan.name,
    '--branch',
    plan.branch,
    ...(plan.reference === null ? [] : ['--reference', plan.reference]),
    '--comment',
    plan.comment,
    '--activate',
    '--json',
  ]
}

/**
 * `orca worktree current` 的参数：按当前目录认出工作区所属的仓库。
 * @returns 不含可执行文件的参数列表。
 */
export function worktreeCurrentArgs(): readonly string[] {
  return ['worktree', 'current', '--json']
}

/**
 * `orca worktree list` 的参数：限定到一个仓库。
 * @param repoId - `orca worktree current` 返回的仓库 id。
 * @returns 不含可执行文件的参数列表。
 */
export function worktreeListArgs(repoId: string): readonly string[] {
  return ['worktree', 'list', '--repo', `id:${repoId}`, '--json']
}

/**
 * 去掉 `refs/heads/` 前缀，得到展示与匹配用的分支名。
 * @param branch - Git 分支引用，可能带前缀。
 * @returns 裸分支名。
 */
export function normalizeBranch(branch: string): string {
  return branch.startsWith('refs/heads/') ? branch.slice('refs/heads/'.length) : branch
}

/**
 * 从 `orca worktree list --json` 的输出里读出 worktree 记录。
 *
 * 命令输出的信封形状是 `{ id, ok, result: { worktrees } }`；也接受只有
 * `result` 或裸 `worktrees` 的形状，避免宿主小版本差异让幂等判断失效。
 * @param stdout - 命令的标准输出。
 * @returns 记录列表；输出不是可识别的 JSON 时是 undefined。
 */
export function parseWorktreeListOutput(stdout: string): readonly WorktreeRecord[] | undefined {
  const payload = parseJson(stdout)
  if (payload === undefined) return undefined

  const result = resultOf(payload)
  const list = result['worktrees']
  if (!Array.isArray(list)) return undefined

  const records: WorktreeRecord[] = []
  for (const entry of list) {
    const record = readWorktree(entry)
    if (record !== undefined) records.push(record)
  }
  return records
}

/**
 * 从 `orca worktree current --json` 的输出里读出当前工作区及它的仓库 id。
 * @param stdout - 命令的标准输出。
 * @returns 当前工作区；输出不可识别或缺少仓库 id 时是 undefined。
 */
export function parseWorktreeCurrentOutput(stdout: string): CurrentWorktree | undefined {
  const payload = parseJson(stdout)
  if (payload === undefined) return undefined

  const record = readWorktree(resultOf(payload)['worktree'])
  if (record === undefined || record.repoId === null) return undefined
  return {
    id: record.id,
    path: record.path,
    branch: record.branch,
    displayName: record.displayName,
    repoId: record.repoId,
  }
}

/**
 * 从 `orca worktree create --json` 的输出里读出新建的 worktree。
 * @param stdout - 命令的标准输出。
 * @returns 记录；输出不是可识别的 JSON 或缺少字段时是 undefined。
 */
export function parseWorktreeCreateOutput(stdout: string): WorktreeRecord | undefined {
  const payload = parseJson(stdout)
  if (payload === undefined) return undefined

  return readWorktree(resultOf(payload)['worktree'])
}

/**
 * 找分支名相同的既有 worktree。
 * @param records - 当前仓库的 worktree。
 * @param branch - 目标分支名。
 * @returns 命中的记录；没有时是 undefined。
 */
export function findWorktreeByBranch(
  records: readonly WorktreeRecord[],
  branch: string,
): WorktreeRecord | undefined {
  const target = normalizeBranch(branch)
  return records.find((record) => normalizeBranch(record.branch) === target)
}

/** Orca 的 JSON 信封：`result` 存在时取它，否则把根对象当作结果。 */
function resultOf(payload: Record<string, unknown>): Record<string, unknown> {
  return isRecord(payload['result']) ? payload['result'] : payload
}

function parseJson(stdout: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(stdout)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function readWorktree(value: unknown): WorktreeRecord | undefined {
  if (!isRecord(value)) return undefined
  const id = value['id']
  const path = value['path']
  const branch = value['branch']
  if (typeof id !== 'string' || typeof path !== 'string' || typeof branch !== 'string') {
    return undefined
  }
  const displayName = value['displayName']
  const repoId = value['repoId']
  return {
    id,
    path,
    branch,
    displayName: typeof displayName === 'string' ? displayName : '',
    repoId: typeof repoId === 'string' ? repoId : null,
  }
}
