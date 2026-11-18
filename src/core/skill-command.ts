/**
 * 技能命令写法的判定规则。
 *
 * 纯规则：设置值、探测结果与上次记住的写法进来，生效的写法与来源出去。
 * 优先级是手动设置 > 探测 > 上次记住 > 默认；没有 agent 在跑时用记住的值兜底，
 * 一次都没探测到时用默认写法，与上游 matt 技能保持一致。
 */
import {
  DEFAULT_SKILL_COMMAND_STYLE,
  SKILL_COMMAND_STYLES,
  type SkillCommandResolution,
  type SkillCommandStyle,
} from '../protocol/skill-command.ts'

/**
 * Orca 认识到的 agent 类型到技能命令写法的对应。
 *
 * 认不出的类型不投票：宁可回落到默认写法，也不要猜错前缀。
 */
const AGENT_KIND_STYLE: Readonly<Record<string, SkillCommandStyle>> = {
  claude: 'claude',
  openclaude: 'claude',
  opencode: 'claude',
  opencode2: 'claude',
  zcode: 'claude',
  grok: 'claude',
  codex: 'codex',
  omp: 'omp',
  pi: 'omp',
}

/** 宿主里一个 agent 的类型与状态；判定写法只需要这两项。 */
export interface AgentKindState {
  /** agent 类型：Orca 认识到的 `claude` / `codex` / `omp` 等。 */
  readonly kind: string
  /** agent 状态；`done` 表示这一轮已经结束。 */
  readonly state: string
}

/** 判定技能命令写法需要的输入。 */
export interface SkillCommandInputs {
  /** 设置里的值；`auto`、空与非法值都当没有设置。 */
  readonly setting: string | null | undefined
  /** 探测到的写法；没有 agent 在跑、类型认不出或同时有多种写法时为 null。 */
  readonly detected: SkillCommandStyle | null
  /** 上次探测到的写法。 */
  readonly remembered: SkillCommandStyle | null
}

/**
 * 判定生效的技能命令写法。
 * @param inputs - 设置值、探测结果与上次记住的写法。
 * @returns 生效的写法与它的来源。
 */
export function resolveSkillCommand(inputs: SkillCommandInputs): SkillCommandResolution {
  const setting = toSkillCommandStyle(inputs.setting)
  if (setting !== null) return { style: setting, source: 'setting' }
  if (inputs.detected !== null) return { style: inputs.detected, source: 'detected' }
  if (inputs.remembered !== null) return { style: inputs.remembered, source: 'remembered' }
  return { style: DEFAULT_SKILL_COMMAND_STYLE, source: 'default' }
}

/**
 * 按宿主里的 agent 定写法。
 *
 * 先看正在跑的 agent；没有正在跑的（或在跑的认不出）再看所有 agent。
 * 只有一种写法时才给结果：多种写法同时在跑算歧义，返回 null 让上层回落到记住的值。
 * @param agents - 宿主里的 agent 列表。
 * @returns 唯一确定的写法；定不了时为 null。
 */
export function styleForAgents(agents: readonly AgentKindState[]): SkillCommandStyle | null {
  const known = agents.filter((agent) => AGENT_KIND_STYLE[agent.kind] !== undefined)
  if (known.length === 0) return null
  const live = known.filter((agent) => agent.state !== 'done')
  const pool = live.length > 0 ? live : known
  const styles = new Set(pool.map((agent) => AGENT_KIND_STYLE[agent.kind]))
  if (styles.size !== 1) return null
  const [style] = styles
  return style ?? null
}

/**
 * 把设置值转成写法；`auto` 与非法值都返回 null。
 * @param value - 设置里的原始值。
 * @returns 已知写法；不是已知写法时为 null。
 */
export function toSkillCommandStyle(value: string | null | undefined): SkillCommandStyle | null {
  if (value === null || value === undefined) return null
  return SKILL_COMMAND_STYLES.find((style) => style === value) ?? null
}
