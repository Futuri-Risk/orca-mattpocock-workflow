/**
 * 面板侧的技能命令写法。
 *
 * 复制手势前问一次 worker：要复制出去的 `/技能名` 必须和用户当前客户端一致，
 * 否则技能不会被加载。worker 不可用或返回不认识的值时回落到默认写法，
 * 复制提示词不能因为拿不到写法就失败。
 */
import { DEFAULT_SKILL_COMMAND_STYLE, type SkillCommandStyle } from '../protocol/skill-command.ts'
import type { PanelClient } from './transport.ts'

/**
 * 读取当前生效的技能命令写法。
 * @param client - 面板客户端。
 * @returns 生效的写法；读不到时是默认写法。
 */
export async function resolveSkillCommandStyle(client: PanelClient): Promise<SkillCommandStyle> {
  try {
    const result = await client.skillCommand()
    if (!result.ok) return DEFAULT_SKILL_COMMAND_STYLE
    return result.result.style
  } catch {
    return DEFAULT_SKILL_COMMAND_STYLE
  }
}
