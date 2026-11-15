/**
 * 工作流定义：插件自带的入池命令、它们可推荐的下一步、matt 技能的命令名，
 * 以及帮助页的流程图。
 *
 * 建票命令正文（worker）和帮助页（面板）都从这里读取，任何一边漏了或多了命令，
 * 两边的防漂移测试都会失败。这里只放结构、id 与关系；用户可见文案在
 * `src/protocol/i18n.ts` 的目录里，字段名带 `Key` 或 `MessageId`。
 */
import type { MessageId } from './i18n.ts'
import { PANEL_SKILLS } from './env-check.ts'
import { TRACKER_LABELS, type TrackerLabelNames } from './labels.ts'

/** 命令的归属：插件自带，还是 matt 的技能。 */
export type FlowOwner = 'plugin' | 'matt'

/** 流程里出现的一个命令。 */
export interface FlowCommand {
  readonly name: string
  readonly owner: FlowOwner
  /** 帮助页上的一句话说明（目录键）；不写技能内部的步骤。 */
  readonly summaryKey: MessageId
}

/**
 * 流程里的全部命令。入池命令由插件在内存里注册，处理命令来自 matt 的技能。
 */
export const FLOW_COMMANDS = {
  intakeBug: {
    name: 'mattwf-bug',
    owner: 'plugin',
    summaryKey: 'flow.command.intakeBug.summary',
  },
  intakeFeature: {
    name: 'mattwf-feature',
    owner: 'plugin',
    summaryKey: 'flow.command.intakeFeature.summary',
  },
  triage: { name: PANEL_SKILLS.triage, owner: 'matt', summaryKey: 'flow.command.triage.summary' },
  toSpec: { name: PANEL_SKILLS.toSpec, owner: 'matt', summaryKey: 'flow.command.toSpec.summary' },
  toTickets: {
    name: PANEL_SKILLS.toTickets,
    owner: 'matt',
    summaryKey: 'flow.command.toTickets.summary',
  },
  grillWithDocs: {
    name: PANEL_SKILLS.grillWithDocs,
    owner: 'matt',
    summaryKey: 'flow.command.grillWithDocs.summary',
  },
  wayfinder: {
    name: PANEL_SKILLS.wayfinder,
    owner: 'matt',
    summaryKey: 'flow.command.wayfinder.summary',
  },
  diagnosingBugs: {
    name: PANEL_SKILLS.diagnosingBugs,
    owner: 'matt',
    summaryKey: 'flow.command.diagnosingBugs.summary',
  },
  implement: {
    name: PANEL_SKILLS.implement,
    owner: 'matt',
    summaryKey: 'flow.command.implement.summary',
  },
} as const satisfies Record<string, FlowCommand>

/** 流程命令的 id。 */
export type FlowCommandId = keyof typeof FLOW_COMMANDS

/** 建票后可推荐的下一步。 */
export interface NextStep {
  readonly command: FlowCommandId
  /** 什么情况下推荐这一步；写进建票命令正文。 */
  readonly whenKey: MessageId
  /** 推荐时附带的提醒；没有为 null。 */
  readonly reminderKey: MessageId | null
}

/**
 * 建票后可以推荐的下一步。缺陷与需求各自从里面取子集，
 * 建票命令正文只列自己候选里的命令。
 */
export const NEXT_STEPS = {
  triage: {
    command: 'triage',
    whenKey: 'flow.nextStep.triage.when',
    reminderKey: null,
  },
  toSpec: {
    command: 'toSpec',
    whenKey: 'flow.nextStep.toSpec.when',
    reminderKey: 'flow.nextStep.toSpec.reminder',
  },
  grillWithDocs: {
    command: 'grillWithDocs',
    whenKey: 'flow.nextStep.grillWithDocs.when',
    reminderKey: null,
  },
  wayfinder: {
    command: 'wayfinder',
    whenKey: 'flow.nextStep.wayfinder.when',
    reminderKey: null,
  },
} as const satisfies Record<string, NextStep>

/** 下一步候选的 id。 */
export type NextStepId = keyof typeof NEXT_STEPS

/** 入池的两种票。 */
export type IntakeKind = 'bug' | 'feature'

/** 一个入池命令的定义。 */
export interface IntakeCommandDefinition {
  readonly kind: IntakeKind
  readonly command: FlowCommandId
  /** 技能描述（`SKILL.md` 的 frontmatter）。 */
  readonly descriptionKey: MessageId
  /** 填进输入框的槽位（目录键）；只是引导，不做格式校验。 */
  readonly slots: readonly MessageId[]
  /** 建票时打上的标签；需求票不预设分类。 */
  readonly labelRoles: readonly (keyof TrackerLabelNames)[]
  /** 建完后可以推荐的下一步；缺陷票只能推荐 triage。 */
  readonly nextSteps: readonly NextStepId[]
}

/** 两个入池命令。命令名统一带 `mattwf-` 前缀，和 matt 的技能区分。 */
export const INTAKE_COMMANDS = {
  bug: {
    kind: 'bug',
    command: 'intakeBug',
    descriptionKey: 'flow.command.intakeBug.description',
    slots: ['intake.bug.slot1', 'intake.bug.slot2', 'intake.bug.slot3'],
    labelRoles: ['bug', 'needsTriage'],
    nextSteps: ['triage'],
  },
  feature: {
    kind: 'feature',
    command: 'intakeFeature',
    descriptionKey: 'flow.command.intakeFeature.description',
    slots: ['intake.feature.slot1'],
    labelRoles: ['needsTriage'],
    nextSteps: ['triage', 'toSpec', 'grillWithDocs', 'wayfinder'],
  },
} as const satisfies Record<IntakeKind, IntakeCommandDefinition>

/**
 * 状态节点的文字：追踪标签名按原样显示（产品契约，不翻译），
 * 其余状态文字从目录取。
 */
export type FlowNodeState =
  | { readonly label: string }
  | { readonly key: MessageId }

/** 流程图的一个节点：命令节点或状态节点，二选一。 */
export interface FlowNode {
  /** 命令节点对应的命令；状态节点为 null。 */
  readonly command: FlowCommandId | null
  /** 状态节点显示的文字；命令节点为 null。 */
  readonly state: FlowNodeState | null
  /** 节点下方的一句说明（目录键）；没有为 null。 */
  readonly noteKey: MessageId | null
  /** agent 在这里停下，等用户发下一条命令。 */
  readonly stops: boolean
}

/** 流程图的一行；一行里多个节点表示分叉。 */
export interface FlowRow {
  readonly nodes: readonly FlowNode[]
}

/** 帮助页上的一张流程图；行按从上到下的顺序相连。 */
export interface FlowDiagram {
  readonly id: string
  readonly titleKey: MessageId
  readonly summaryKey: MessageId
  readonly rows: readonly FlowRow[]
}

/** 命令节点的公共字段；`stops` 默认 true，终点节点再单独覆盖。 */
const STOPPING_COMMAND_NODE = {
  command: null,
  state: null,
  noteKey: null,
  stops: true,
} as const

/** 帮助页的四张图：入池状态机、需求链、缺陷链，以及访谈与画图的取舍。 */
export const FLOW_DIAGRAMS: readonly FlowDiagram[] = [
  {
    id: 'intake-triage',
    titleKey: 'flow.diagram.intake-triage.title',
    summaryKey: 'flow.diagram.intake-triage.summary',
    rows: [
      {
        nodes: [
          { ...STOPPING_COMMAND_NODE, command: 'intakeBug', noteKey: 'flow.node.defect' },
          { ...STOPPING_COMMAND_NODE, command: 'intakeFeature', noteKey: 'flow.node.feature' },
        ],
      },
      {
        nodes: [
          {
            command: null,
            state: { label: TRACKER_LABELS.needsTriage },
            noteKey: null,
            stops: false,
          },
        ],
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'triage', noteKey: 'flow.node.triage' }] },
      {
        nodes: [
          {
            command: null,
            state: { label: TRACKER_LABELS.readyForAgent },
            noteKey: null,
            stops: false,
          },
          {
            command: null,
            state: { label: TRACKER_LABELS.readyForHuman },
            noteKey: null,
            stops: false,
          },
          {
            command: null,
            state: { label: TRACKER_LABELS.needsInfo },
            noteKey: null,
            stops: false,
          },
          {
            command: null,
            state: { label: TRACKER_LABELS.wontfix },
            noteKey: null,
            stops: false,
          },
        ],
      },
    ],
  },
  {
    id: 'feature-chain',
    titleKey: 'flow.diagram.feature-chain.title',
    summaryKey: 'flow.diagram.feature-chain.summary',
    rows: [
      {
        nodes: [
          {
            ...STOPPING_COMMAND_NODE,
            command: 'intakeFeature',
            noteKey: 'flow.node.feature-chain.intakeFeature',
          },
        ],
      },
      {
        nodes: [
          {
            command: null,
            state: { label: TRACKER_LABELS.needsTriage },
            noteKey: null,
            stops: false,
          },
        ],
      },
      {
        nodes: [
          {
            ...STOPPING_COMMAND_NODE,
            command: 'triage',
            noteKey: 'flow.node.feature-chain.triage',
          },
          {
            ...STOPPING_COMMAND_NODE,
            command: 'toSpec',
            noteKey: 'flow.node.feature-chain.toSpec',
          },
          {
            ...STOPPING_COMMAND_NODE,
            command: 'grillWithDocs',
            noteKey: 'flow.node.feature-chain.grillWithDocs',
          },
          {
            ...STOPPING_COMMAND_NODE,
            command: 'wayfinder',
            noteKey: 'flow.node.feature-chain.wayfinder',
          },
        ],
      },
      {
        nodes: [
          {
            ...STOPPING_COMMAND_NODE,
            command: 'toSpec',
            noteKey: 'flow.node.feature-chain.toSpecAfter',
          },
        ],
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'toTickets', noteKey: null }] },
      {
        nodes: [
          { ...STOPPING_COMMAND_NODE, command: 'implement', noteKey: null, stops: false },
        ],
      },
    ],
  },
  {
    id: 'bug-chain',
    titleKey: 'flow.diagram.bug-chain.title',
    summaryKey: 'flow.diagram.bug-chain.summary',
    rows: [
      {
        nodes: [
          {
            ...STOPPING_COMMAND_NODE,
            command: 'intakeBug',
            noteKey: 'flow.node.bug-chain.intakeBug',
          },
        ],
      },
      {
        nodes: [
          {
            command: null,
            state: { label: TRACKER_LABELS.needsTriage },
            noteKey: null,
            stops: false,
          },
        ],
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'triage', noteKey: null }] },
      {
        nodes: [
          {
            ...STOPPING_COMMAND_NODE,
            command: 'diagnosingBugs',
            noteKey: 'flow.node.bug-chain.diagnose',
          },
          {
            command: 'implement',
            state: null,
            noteKey: 'flow.node.bug-chain.implement',
            stops: false,
          },
        ],
      },
      {
        nodes: [
          {
            command: 'implement',
            state: null,
            noteKey: 'flow.node.bug-chain.implementAfter',
            stops: false,
          },
        ],
      },
    ],
  },
  {
    id: 'choose-interview',
    titleKey: 'flow.diagram.choose-interview.title',
    summaryKey: 'flow.diagram.choose-interview.summary',
    rows: [
      {
        nodes: [
          {
            command: null,
            state: { key: 'flow.node.choose-interview.state' },
            noteKey: null,
            stops: false,
          },
        ],
      },
      {
        nodes: [
          {
            ...STOPPING_COMMAND_NODE,
            command: 'grillWithDocs',
            noteKey: 'flow.node.choose-interview.grill',
          },
          {
            ...STOPPING_COMMAND_NODE,
            command: 'wayfinder',
            noteKey: 'flow.node.choose-interview.wayfinder',
          },
        ],
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'toSpec', noteKey: null }] },
    ],
  },
]
