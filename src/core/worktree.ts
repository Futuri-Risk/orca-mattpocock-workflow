/**
 * 为工单创建 Orca worktree 的纯逻辑：分支名推导、显示名与注释、命令行参数拼装，
 * 以及 Orca `--json` 输出的解析。
 *
 * 这里不做 IO：命令由 worker 用注入的执行器跑，面板只展示结果。
 * 命名规则与仓库里既有的 `feat/4-…`、`bugfix/1-…` 保持一致：
 * 缺陷票用 `bugfix`，其余（含增强与未分类）用 `feat`。
 */
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
  /** 工单标题的单行形式。 */
  readonly name: string
  /** `<类型>/<票号>-<slug>`；slug 为空时为 `<类型>/<票号>`。 */
  readonly branch: string
  /** 工单链接，取自后端详情，不拼接。 */
  readonly reference: string
  /** `<票号> <标题摘要>`。 */
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
 * 标题作为 worktree 显示名：去掉换行与多余空白，按单行使用。
 * @param title - 工单标题。
 * @returns 单行标题。
 */
export function worktreeDisplayName(title: string): string {
  return title.replace(/\s+/g, ' ').trim()
}

/**
 * 工单摘要在注释里的写法：`<票号> <单行标题>`。
 * @param reference - 工单引用，例如 `#6`。
 * @param title - 工单标题。
 * @returns 单行注释。
 */
export function worktreeComment(ticketRef: string, title: string): string {
  return `${ticketRef} ${worktreeDisplayName(title)}`
}

/**
 * 一次创建的全部命名与引用。
 * @param input - 编号、标题、分类与后端给出的链接。
 * @returns 可直接拼进命令行的计划。
 */
export function planWorktree(input: {
  readonly number: number
  readonly title: string
  readonly category: WorktreeCategory
  readonly reference: string
}): WorktreePlan {
  return {
    name: worktreeDisplayName(input.title),
    branch: worktreeBranchName(input.number, input.title, input.category),
    reference: input.reference,
    comment: worktreeComment(`#${String(input.number)}`, input.title),
  }
}

/**
 * `orca worktree create` 的参数。
 *
 * 只用 `--reference` 挂链接，不与 `--issue` / `--pr` / `--gitlab-issue` 混用；
 * 不传 `--base-branch`（用仓库默认基线）、不传父工作区参数（由 Orca 按当前目录推断）、
 * 不传 `--agent` / `--prompt`（本次只建工作区）。
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
    '--reference',
    plan.reference,
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
