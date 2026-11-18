/**
 * 技能命令写法的解析：读插件设置、探测宿主里在跑的 agent、读写插件私有存储。
 *
 * 探测要 `agent:read` 能力，宿主没授权或方法不可用时探测不到：这时用上次记住的写法，
 * 一次都没记住过就用默认写法。任何一步失败都只降级、不报错——面板拿不到写法时
 * 仍要能复制提示词。
 */
import {
  resolveSkillCommand,
  styleForAgents,
  toSkillCommandStyle,
  type AgentKindState,
} from '../core/skill-command.ts'
import {
  SKILL_COMMAND_SETTING_KEY,
  type SkillCommandResolution,
  type SkillCommandStyle,
} from '../protocol/skill-command.ts'

/** 记住上次探测到的写法的存储键。 */
export const SKILL_COMMAND_STORAGE_KEY = 'skillCommand.style'

/** 解析技能命令写法要用的宿主能力。 */
export interface SkillCommandHost {
  /** 读插件设置；没有这个设置项时返回 null。 */
  readonly getSetting: (key: string) => Promise<string | null>
  /** 列出聚焦工作区里的 agent；宿主不支持时返回空数组。 */
  readonly listAgents: () => Promise<readonly AgentKindState[]>
  /** 读上次记住的写法。 */
  readonly readRemembered: () => Promise<string | null>
  /** 记住探测到的写法。 */
  readonly writeRemembered: (style: SkillCommandStyle) => Promise<void>
}

/** 技能命令写法的解析服务。 */
export interface SkillCommandService {
  /** 解析当前生效的写法；探测成功时顺手记住它。 */
  resolve(): Promise<SkillCommandResolution>
}

/**
 * 创建技能命令写法的解析服务。
 * @param host - 宿主能力：设置、agent 列表与插件私有存储。
 * @returns 解析服务。
 */
export function createSkillCommandService(host: SkillCommandHost): SkillCommandService {
  return {
    async resolve(): Promise<SkillCommandResolution> {
      const setting = await readOrNull(() => host.getSetting(SKILL_COMMAND_SETTING_KEY))
      const detected = await detect(host)
      const remembered = toSkillCommandStyle(await readOrNull(() => host.readRemembered()))
      const resolution = resolveSkillCommand({ setting, detected, remembered })
      if (resolution.source === 'detected') {
        await write(() => host.writeRemembered(resolution.style))
      }
      return resolution
    },
  }
}

/** 探测宿主里在跑的 agent；探测不了时没有结果。 */
async function detect(host: SkillCommandHost): Promise<SkillCommandStyle | null> {
  const agents = await readOrNull(() => host.listAgents())
  if (agents === null) return null
  return styleForAgents(agents)
}

/** 读一步的结果；失败时按“没有”处理。 */
async function readOrNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch {
    return null
  }
}

/** 写一步的结果；失败只降级，不影响本次解析。 */
async function write(writeStep: () => Promise<void>): Promise<void> {
  try {
    await writeStep()
  } catch {
    // 存不下就靠下一次探测，解析结果本身不受影响。
  }
}
