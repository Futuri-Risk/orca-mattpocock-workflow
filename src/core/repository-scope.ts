/**
 * 仓库作用域：一个仓库的主 worktree 根目录，作为工单缓存的仓库级身份。
 *
 * 同一个仓库的每个 worktree 有不同的工作区根目录，但共享同一份工单状态；
 * 作用域只决定缓存归到哪一份，命令（git / gh / glab / tea）仍然以当前工作区为 cwd。
 *
 * 这里只解析 `git worktree list --porcelain` 的输出：目录是否存在由调用方判断，
 * core 不做 IO。
 */
import type { BackendKind } from '../protocol/backend.ts'

/** porcelain 里一条 worktree 记录的行首。 */
const WORKTREE_PREFIX = 'worktree '

/**
 * 从 `git worktree list --porcelain` 的输出里读出全部 worktree 根目录。
 *
 * 顺序与 git 输出一致：主 worktree 在前，附属 worktree 在后。
 * 输出为空或格式不认识时返回空列表，交给调用方退回工作区根目录。
 * @param stdout - 命令的标准输出。
 * @returns worktree 根目录，按 git 给出的顺序去重。
 */
export function parseWorktreeRoots(stdout: string): readonly string[] {
  const roots: string[] = []
  for (const raw of stdout.split('\n')) {
    // Windows 的 git 会输出 CRLF；去掉行尾的 \r 再比较。
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!line.startsWith(WORKTREE_PREFIX)) continue
    const root = line.slice(WORKTREE_PREFIX.length)
    if (root.length === 0 || roots.includes(root)) continue
    roots.push(root)
  }
  return roots
}

/**
 * 取第一条仍然存在的 worktree 根目录。
 *
 * 主 worktree 目录被删掉时，下一个存在的 worktree 才是这个仓库的实际位置。
 * @param roots - git 给出的 worktree 根目录。
 * @param exists - 目录是否存在；可以是异步判断。
 * @returns 第一个存在的根目录；一条都不存在时是 undefined。
 */
export async function pickExistingRoot(
  roots: readonly string[],
  exists: (path: string) => boolean | Promise<boolean>,
): Promise<string | undefined> {
  // 顺序就是优先级：第一条存在的才是这个仓库的位置。
  for (const root of roots) {
    if (await exists(root)) return root
  }
  return undefined
}

/**
 * 缓存键的尝试顺序：仓库作用域优先，工作区兜底。
 *
 * 作用域与工作区是同一个目录（非 git 工作区、主 worktree）时只查一次。
 * @param scopeRoot - 仓库作用域根目录。
 * @param workspaceRoot - 当前工作区根目录。
 * @returns 按优先级排列的缓存键。
 */
export function scopedKeysOf(scopeRoot: string, workspaceRoot: string): readonly string[] {
  return scopeRoot === workspaceRoot ? [scopeRoot] : [scopeRoot, workspaceRoot]
}

/**
 * 缓存键：托管后端按仓库作用域归并，本地 Markdown 按工作区隔离。
 *
 * 本地 Markdown 的「仓库」是当前工作区里的 `.scratch/` 目录树，
 * 一个 worktree 的本地工单不能串到另一个 worktree。
 * @param kind - 后端类型。
 * @param scopeRoot - 仓库作用域根目录。
 * @param workspaceRoot - 当前工作区根目录。
 * @returns 本地快照库与内存缓存共用的键。
 */
export function storeKeyOf(kind: BackendKind, scopeRoot: string, workspaceRoot: string): string {
  return kind === 'markdown' ? workspaceRoot : scopeRoot
}
