/**
 * 技能命令的写法形态。
 *
 * 不同客户端加载技能的手势不同：Claude Code 认 `/技能名`，omp（pi 内核）只展开
 * `/skill:技能名`，Codex 认 `$技能名`。面板复制出去的手势必须和用户当前客户端一致，
 * 否则技能不会加载——`disable-model-invocation` 的技能只能由用户显式敲手势。
 */

/** 一种技能命令写法。 */
export type SkillCommandStyle = 'claude' | 'omp' | 'codex'

/** 全部写法，顺序固定。 */
export const SKILL_COMMAND_STYLES = ['claude', 'omp', 'codex'] as const

/** 每种写法的手势前缀。 */
export const SKILL_COMMAND_PREFIX: Readonly<Record<SkillCommandStyle, string>> = {
  claude: '/',
  omp: '/skill:',
  codex: '$',
}

/** 默认写法：与上游 matt 技能一致，存量用户看到的输出不变。 */
export const DEFAULT_SKILL_COMMAND_STYLE: SkillCommandStyle = 'claude'

/** 设置项的键：手动指定写法。 */
export const SKILL_COMMAND_SETTING_KEY = 'skillCommand'

/** 设置项允许的值；`auto` 表示交给探测。 */
export const SKILL_COMMAND_SETTING_VALUES = ['auto', ...SKILL_COMMAND_STYLES] as const

/** 设置项的值类型。 */
export type SkillCommandSettingValue = (typeof SKILL_COMMAND_SETTING_VALUES)[number]

/** 生效写法的来源。 */
export const SKILL_COMMAND_SOURCES = ['setting', 'detected', 'remembered', 'default'] as const

/** 生效写法的来源类型。 */
export type SkillCommandSource = (typeof SKILL_COMMAND_SOURCES)[number]

/** 生效的写法与它的来源。 */
export interface SkillCommandResolution {
  readonly style: SkillCommandStyle
  readonly source: SkillCommandSource
}

/**
 * 面板请求名：读取当前生效的技能命令写法。
 * 不在工单 RPC 表里，是插件自己的额外处理器。
 */
export const SKILL_COMMAND_METHOD = 'skill.command'
