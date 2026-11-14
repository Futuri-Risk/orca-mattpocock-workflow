/**
 * 技能清单：按 Orca 的技能目录扫描磁盘。
 *
 * Orca 没有「技能服务」这样的宿主接口，agent 从这些目录里发现技能：
 * 用户级的 `~/.claude/skills`、`~/.codex/skills`、`~/.agents/skills`，
 * 以及仓库级的 `<repo>/.agents/skills`。目录里有 `SKILL.md` 的子目录就是一个技能。
 */
import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 用户级技能目录，相对用户主目录。 */
const PROVIDER_SKILL_DIRECTORIES: readonly string[] = [
  '.claude/skills',
  '.codex/skills',
  '.agents/skills',
]

/** 仓库级技能目录，相对工作区根目录。 */
const REPO_SKILL_DIRECTORY = '.agents/skills'

/** 技能目录的读取能力；环境检查与入池技能安装共用。 */
export interface SkillCatalog {
  /** 当前工作区可见的技能名；读取失败时是空列表。 */
  names(workspaceRoot: string): Promise<readonly string[]>
  /** 某个技能在哪个目录里；没有找到时是 undefined。 */
  locate(workspaceRoot: string, name: string): Promise<string | undefined>
}

/**
 * 创建基于文件系统的技能清单。
 * @returns 技能清单。
 */
export function createSkillCatalog(): SkillCatalog {
  return {
    async names(workspaceRoot) {
      return await listSkillNames(skillDirectories(workspaceRoot))
    },
    async locate(workspaceRoot, name) {
      return await findSkillFile(skillDirectories(workspaceRoot), name)
    },
  }
}

/**
 * 列出某个技能在哪些目录里被安装。
 * @param name - 技能名。
 * @returns 命中的目录；没有时是空数组。
 */
export async function locateProviderSkillDirectories(name: string): Promise<readonly string[]> {
  const home = resolveHome()
  if (home === undefined) return []
  const found: string[] = []
  for (const directory of providerSkillDirectories(home)) {
    if (await findSkillFile([directory], name) !== undefined) found.push(directory)
  }
  return found
}

/**
 * 用户级技能目录。
 * @param home - 用户主目录。
 * @returns 目录路径列表。
 */
export function providerSkillDirectories(home: string): readonly string[] {
  return PROVIDER_SKILL_DIRECTORIES.map((directory) => join(home, directory))
}

/**
 * 一个工作区可见的全部技能目录：用户级在前，仓库级在后。
 * @param workspaceRoot - 工作区根目录。
 * @returns 目录路径列表。
 */
export function skillDirectories(workspaceRoot: string): readonly string[] {
  const home = resolveHome()
  const directories = home === undefined ? [] : [...providerSkillDirectories(home)]
  return [...directories, join(workspaceRoot, REPO_SKILL_DIRECTORY)]
}

/**
 * 列出这些目录里的技能名。
 * @param directories - 技能目录。
 * @returns 去重后的技能名；目录读不到时跳过。
 */
export async function listSkillNames(directories: readonly string[]): Promise<readonly string[]> {
  const names = new Set<string>()
  for (const directory of directories) {
    for (const name of await skillNamesIn(directory)) names.add(name)
  }
  return [...names]
}

/**
 * 找某个技能的 `SKILL.md`。
 * @param directories - 技能目录。
 * @param name - 技能名。
 * @returns 文件路径；没有时是 undefined。
 */
export async function findSkillFile(
  directories: readonly string[],
  name: string,
): Promise<string | undefined> {
  for (const directory of directories) {
    const path = join(directory, name, 'SKILL.md')
    if (await isFile(path)) return path
  }
  return undefined
}

/** 一个目录里的技能名：含有 `SKILL.md` 的子目录。 */
async function skillNamesIn(directory: string): Promise<readonly string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    // 目录不存在或不可读：这个目录没有技能。
    return []
  }
  const names: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (await isFile(join(directory, entry.name, 'SKILL.md'))) names.push(entry.name)
  }
  return names
}

/** 路径存在且是普通文件时为 true。 */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** 用户主目录；解析不到时是 undefined。 */
function resolveHome(): string | undefined {
  try {
    const home = homedir()
    return home.length > 0 ? home : undefined
  } catch {
    return undefined
  }
}
