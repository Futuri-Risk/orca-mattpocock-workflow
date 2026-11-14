/**
 * 把入池技能装进 agent 的技能目录。
 *
 * Orca 插件不能注册运行时技能，只能把技能写成文件放进 agent 会扫描的目录。
 * 这是用户机器上的文件写入，因此只在用户显式触发安装动作时才执行。
 */
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { FLOW_COMMANDS } from '../protocol/flow.ts'
import { providerSkillDirectories } from './skill-catalog.ts'

/** 入池技能的名字；与协议里的命令名一致。 */
const POOL_SKILL_NAMES = [
  FLOW_COMMANDS.intakeBug.name,
  FLOW_COMMANDS.intakeFeature.name,
] as const

/** 一次安装的结果。 */
export interface SkillInstallResult {
  /** 检测到的目标目录：已存在的 provider 技能目录。 */
  readonly targets: readonly string[]
  /** 写入成功的技能与目录。 */
  readonly installed: readonly { readonly skill: string; readonly directory: string }[]
  /** 写入失败的技能与目录，以及原因。 */
  readonly failed: readonly {
    readonly skill: string
    readonly directory: string
    readonly reason: string
  }[]
}

/** 安装动作的选项。 */
export interface SkillInstallOptions {
  /** 目标目录；不给时用检测到的 provider 技能目录。测试用它指定临时目录。 */
  readonly targets?: readonly string[]
}

/**
 * 把入池技能复制进检测到的 provider 技能目录。
 *
 * 只写已经存在的目录：凭空造一个 `~/.codex/skills` 不会让任何 agent 认它，
 * 反而留下用户不认得的空目录。
 * @param options - 目标目录覆盖。
 * @returns 安装结果。
 */
export async function installPoolSkills(options: SkillInstallOptions = {}): Promise<SkillInstallResult> {
  const targets =
    options.targets === undefined ? await existingProviderDirectories() : options.targets
  const source = await locatePluginSkillsDirectory()
  const installed: { skill: string; directory: string }[] = []
  const failed: { skill: string; directory: string; reason: string }[] = []

  if (source === undefined) {
    for (const directory of targets) {
      for (const skill of POOL_SKILL_NAMES) {
        failed.push({ skill, directory, reason: '插件目录里找不到 skills 源文件' })
      }
    }
    return { targets, installed, failed }
  }

  for (const directory of targets) {
    for (const skill of POOL_SKILL_NAMES) {
      try {
        await installSkill(source, skill, directory)
        installed.push({ skill, directory })
      } catch (error) {
        failed.push({
          skill,
          directory,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  return { targets, installed, failed }
}

/** 把一个技能目录复制到目标目录。 */
async function installSkill(source: string, skill: string, target: string): Promise<void> {
  const from = join(source, skill, 'SKILL.md')
  const to = join(target, skill, 'SKILL.md')
  await mkdir(dirname(to), { recursive: true })
  await copyFile(from, to)
}

/** 已经存在的 provider 技能目录。 */
async function existingProviderDirectories(): Promise<readonly string[]> {
  let home: string
  try {
    home = homedir()
  } catch {
    return []
  }
  if (home.length === 0) return []

  const existing: string[] = []
  for (const directory of providerSkillDirectories(home)) {
    if (await isDirectory(directory)) existing.push(directory)
  }
  return existing
}

/** 路径存在且是目录时为 true。 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** 路径存在且是普通文件时为 true。 */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * 找到插件自带的 `skills` 目录。
 *
 * worker 打包后位于 `<插件根>/dist/worker`，源文件位于 `<插件根>/src/worker`，
 * 两种情况下 `skills` 都在上两级；这里向上多找几层，兼容不同的安装布局。
 * @returns 目录路径；找不到时是 undefined。
 */
async function locatePluginSkillsDirectory(): Promise<string | undefined> {
  let current = resolve(import.meta.dirname)
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(current, 'skills')
    if (await isFile(join(candidate, POOL_SKILL_NAMES[0], 'SKILL.md'))) {
      return candidate
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}