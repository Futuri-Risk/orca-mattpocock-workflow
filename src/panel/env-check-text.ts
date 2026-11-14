/**
 * 环境检查的中文文案。宿主只送 id、后端、subject 和解决码，标题、能力说明
 * 都在这里拼，文案只维护一处。主题相关的样式不在这里。
 */
import type { BackendKind } from '../protocol/backend.ts'
import type { CapabilityDiagnostic, EnvCheckItem } from '../protocol/env-check.ts'
import { BACKEND_LABELS } from './backend-label.ts'

/** 环境检查顶部的后端标记；本地后端写全名，避免与“没有后端”混淆。 */
export function envBackendLabel(backend: BackendKind | null): string {
  if (backend === null) return '未判定'
  return backend === 'markdown' ? '本地 Markdown' : (BACKEND_LABELS[backend] ?? backend)
}

/** 后端名到标题前缀的映射。 */
const CLI_TITLES: Readonly<Record<string, { readonly cli: string; readonly auth: string }>> = {
  github: { cli: 'GitHub CLI (gh) 已安装', auth: 'gh 已登录' },
  gitlab: { cli: 'GitLab CLI (glab) 已安装', auth: 'glab 已登录远端实例' },
  gitea: { cli: 'Gitea CLI (tea) 已安装', auth: 'tea 已登录远端实例' },
}

/**
 * 检查项的标题，写成该项应达到的状态。
 * @param item - 检查结果。
 * @returns 中文标题。
 */
export function envCheckTitle(item: EnvCheckItem): string {
  switch (item.id) {
    case 'home':
      return '用户主目录可解析'
    case 'backend':
      // 带候选后端时点名它：用户一眼看出插件认的是哪个后端、缺的是哪一步。
      return item.subject === null
        ? '已选择工单后端'
        : `已选择工单后端（${BACKEND_LABELS[item.subject] ?? item.subject}）`
    case 'cli':
      return CLI_TITLES[item.subject ?? '']?.cli ?? '命令行工具已安装'
    case 'auth':
      return CLI_TITLES[item.subject ?? '']?.auth ?? '命令行工具已登录'
    case 'repository':
      if (item.subject === 'github') return 'GitHub 仓库可达'
      if (item.subject === 'gitlab') return 'GitLab 仓库可达'
      if (item.subject === 'gitea') return 'Gitea 仓库可达'
      return '仓库可达'
    case 'workspace':
      return '工作区已初始化'
    case 'local-issues':
      return '本地工单目录可用'
    case 'skill':
      return `技能 ${item.subject ?? ''} 已安装`
  }
}

interface CapabilityContent {
  readonly label: string
  /** 缺失时影响什么。 */
  readonly impact: string
  /** 缺失时怎么补。 */
  readonly fix: string
}

/**
 * 能力诊断的显示名、影响与补法。
 * worker 侧探测的是命令行工具、远端与技能；面板侧探测的是面板桥、剪贴板与 worker。
 * `skill.<名字>` 这类动态 id 不进表，由 {@link skillCapabilityContent} 兜底。
 */
const CAPABILITIES: Readonly<Record<string, CapabilityContent>> = {
  'cli.gh': {
    label: 'GitHub CLI (gh) 已安装',
    impact: '读不到 GitHub 仓库的工单，列表与详情都不可用。',
    fix: '安装 gh：brew install gh',
  },
  'cli.gh.auth': {
    label: 'gh 已登录',
    impact: 'gh 没登录时读不到远端工单。',
    fix: '运行 gh auth login',
  },
  'cli.glab': {
    label: 'GitLab CLI (glab) 已安装',
    impact: '读不到 GitLab 仓库的工单。',
    fix: '安装 glab：brew install glab',
  },
  'cli.glab.auth': {
    label: 'glab 已登录远端实例',
    impact: 'glab 没登录时读不到远端工单。',
    fix: '运行 glab auth login；自建实例要在登录时填实例地址',
  },
  'cli.tea': {
    label: 'Gitea CLI (tea) 已安装',
    impact: '读不到 Gitea 仓库的工单。',
    fix: '安装 tea：brew install tea',
  },
  'cli.tea.auth': {
    label: 'tea 已登录远端实例',
    impact: 'tea 没登录时读不到远端工单。',
    fix: '运行 tea login add',
  },
  remote: {
    label: '远端地址可解析',
    impact: '认不出仓库用哪个后端，列表读不到工单。',
    fix: '核对 origin 指向的远端地址：git remote -v',
  },
  workspace: {
    label: '工作区可初始化',
    impact: '工作区没按插件要求初始化，本地工单目录与技能都不可用。',
    fix: '让 agent 运行 setup-matt-pocock-skills 初始化当前工作区',
  },
  'local-issues': {
    label: '本地工单目录可读',
    impact: '本地 Markdown 后端读不到 .scratch 里的工单。',
    fix: '按 docs/local-issues.md 的约定放好工单文件',
  },
  'panel-bridge': {
    label: '面板桥',
    impact: '面板发不出请求，工单列表与环境检查都打不开。',
    fix: '升级宿主到提供插件桥的版本后重启面板',
  },
  clipboard: {
    label: '剪贴板',
    impact: '面板内一键复制可能被宿主策略拒绝，会自动尝试兼容写入，仍失败时只能用手动复制区。',
    fix: '点提示词按钮；失败时用小箭头展开手动复制区，选中后按 ⌘C 复制',
  },
  worker: {
    label: 'worker 可达',
    impact: '面板发不出业务请求，工单列表与环境检查都打不开。',
    fix: '确认插件的 worker 已启动：查看宿主日志里的插件启动报错',
  },
}

/** 动态的技能能力 id：worker 侧按 `skill.<技能名>` 逐项上报。 */
function skillCapabilityContent(id: string): CapabilityContent | null {
  if (!id.startsWith('skill.')) return null
  const skill = id.slice('skill.'.length)
  return {
    label: `技能 ${skill} 已安装`,
    impact: '相关的手势与提示词在会话里不可用。',
    fix: `把 ${skill} 装到 Orca 扫描的技能目录（~/.claude/skills、~/.codex/skills、~/.agents/skills 或仓库的 .agents/skills）`,
  }
}

/** 已知能力 id 的索引；动态 id 走 skillCapabilityContent。 */
const CAPABILITY_BY_ID: ReadonlyMap<string, CapabilityContent> = new Map(
  Object.entries(CAPABILITIES),
)

/**
 * 能力诊断的一行文案。
 * @param diagnostic - 一项能力诊断。
 * @returns 显示名、类别、状态；缺失时再带影响与补法。
 */
export function capabilityText(diagnostic: CapabilityDiagnostic): {
  readonly label: string
  readonly category: string
  readonly state: string
  readonly impact: string | null
  readonly fix: string | null
} {
  const content = CAPABILITY_BY_ID.get(diagnostic.id) ?? skillCapabilityContent(diagnostic.id)
  const missing = diagnostic.status === 'missing'

  return {
    label: content?.label ?? diagnostic.id,
    category: diagnostic.category === 'host-service' ? '宿主服务' : '界面扩展点',
    state: missing ? '缺失' : '可用',
    impact: missing ? (content?.impact ?? null) : null,
    fix: missing ? (content?.fix ?? null) : null,
  }
}
