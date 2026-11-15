/**
 * 环境检查的界面文案。宿主只送 id、后端、subject 和解决码，标题、能力说明
 * 都在这里按目录键拼，文案只维护一处。主题相关的样式不在这里。
 */
import type { BackendKind } from '../protocol/backend.ts'
import type { CapabilityDiagnostic, EnvCheckItem } from '../protocol/env-check.ts'
import type { MessageId } from '../protocol/i18n.ts'
import { backendFullLabel, backendLabel } from './backend-label.ts'
import type { Translate } from './i18n.ts'

/** 环境检查顶部的后端标记；本地后端写全名，避免与“没有后端”混淆。 */
export function envBackendLabel(backend: BackendKind | null, t: Translate): string {
  return backendFullLabel(backend, t)
}

/** 后端名到标题前缀的映射。 */
const CLI_TITLES: Readonly<Record<string, { readonly cli: MessageId; readonly auth: MessageId }>> =
  {
    github: { cli: 'env.title.cli.github', auth: 'env.title.auth.github' },
    gitlab: { cli: 'env.title.cli.gitlab', auth: 'env.title.auth.gitlab' },
    gitea: { cli: 'env.title.cli.gitea', auth: 'env.title.auth.gitea' },
  }

const REPOSITORY_TITLES: Readonly<Record<string, MessageId>> = {
  github: 'env.title.repository.github',
  gitlab: 'env.title.repository.gitlab',
  gitea: 'env.title.repository.gitea',
}

/** 检查项 subject 里的后端名；认不出的 subject 原样显示。 */
function backendName(subject: string, t: Translate): string {
  return subject === 'github' || subject === 'gitlab' || subject === 'gitea'
    ? backendLabel(subject, t)
    : subject === 'markdown'
      ? backendLabel('markdown', t)
      : subject
}

/**
 * 检查项的标题，写成该项应达到的状态。
 * @param item - 检查结果。
 * @param t - 当前语言的翻译函数。
 * @returns 标题。
 */
export function envCheckTitle(item: EnvCheckItem, t: Translate): string {
  switch (item.id) {
    case 'home':
      return t('env.title.home')
    case 'backend':
      // 带候选后端时点名它：用户一眼看出插件认的是哪个后端、缺的是哪一步。
      return item.subject === null
        ? t('env.title.backend')
        : t('env.title.backendWith', { backend: backendName(item.subject, t) })
    case 'cli': {
      const titles = CLI_TITLES[item.subject ?? '']
      return titles === undefined ? t('env.title.cliFallback') : t(titles.cli)
    }
    case 'auth': {
      const titles = CLI_TITLES[item.subject ?? '']
      return titles === undefined ? t('env.title.authFallback') : t(titles.auth)
    }
    case 'repository':
      return t(REPOSITORY_TITLES[item.subject ?? ''] ?? 'env.title.repositoryFallback')
    case 'orca':
      return t('env.title.orca')
    case 'workspace':
      return t('env.title.workspace')
    case 'local-issues':
      return t('env.title.localIssues')
    case 'skill':
      return t('env.title.skill', { skill: item.subject ?? '' })
  }
}

interface CapabilityContent {
  readonly label: MessageId
  /** 缺失时影响什么。 */
  readonly impact: MessageId
  /** 缺失时怎么补。 */
  readonly fix: MessageId
}

/**
 * 能力诊断的显示名、影响与补法。
 * worker 侧探测的是命令行工具、远端与技能；面板侧探测的是面板桥、剪贴板与 worker。
 * `skill.<名字>` 这类动态 id 不进表，由 {@link skillCapabilityContent} 兜底。
 */
const CAPABILITIES: Readonly<Record<string, CapabilityContent>> = {
  'cli.gh': {
    label: 'env.cap.cli.gh',
    impact: 'env.cap.cli.gh.impact',
    fix: 'env.cap.cli.gh.fix',
  },
  'cli.gh.auth': {
    label: 'env.cap.cli.ghAuth',
    impact: 'env.cap.cli.ghAuth.impact',
    fix: 'env.cap.cli.ghAuth.fix',
  },
  'cli.glab': {
    label: 'env.cap.cli.glab',
    impact: 'env.cap.cli.glab.impact',
    fix: 'env.cap.cli.glab.fix',
  },
  'cli.glab.auth': {
    label: 'env.cap.cli.glabAuth',
    impact: 'env.cap.cli.glabAuth.impact',
    fix: 'env.cap.cli.glabAuth.fix',
  },
  'cli.tea': {
    label: 'env.cap.cli.tea',
    impact: 'env.cap.cli.tea.impact',
    fix: 'env.cap.cli.tea.fix',
  },
  'cli.tea.auth': {
    label: 'env.cap.cli.teaAuth',
    impact: 'env.cap.cli.teaAuth.impact',
    fix: 'env.cap.cli.teaAuth.fix',
  },
  remote: {
    label: 'env.cap.remote',
    impact: 'env.cap.remote.impact',
    fix: 'env.cap.remote.fix',
  },
  workspace: {
    label: 'env.cap.workspace',
    impact: 'env.cap.workspace.impact',
    fix: 'env.cap.workspace.fix',
  },
  'local-issues': {
    label: 'env.cap.localIssues',
    impact: 'env.cap.localIssues.impact',
    fix: 'env.cap.localIssues.fix',
  },
  'panel-bridge': {
    label: 'env.cap.panelBridge',
    impact: 'env.cap.panelBridge.impact',
    fix: 'env.cap.panelBridge.fix',
  },
  clipboard: {
    label: 'env.cap.clipboard',
    impact: 'env.cap.clipboard.impact',
    fix: 'env.cap.clipboard.fix',
  },
  worker: {
    label: 'env.cap.worker',
    impact: 'env.cap.worker.impact',
    fix: 'env.cap.worker.fix',
  },
}

interface CapabilityText {
  readonly label: string
  readonly impact: string
  readonly fix: string
}

/** 动态的技能能力 id：worker 侧按 `skill.<技能名>` 逐项上报。 */
function skillCapabilityContent(id: string, t: Translate): CapabilityText | null {
  if (!id.startsWith('skill.')) return null
  const skill = id.slice('skill.'.length)
  return {
    label: t('env.cap.skill', { skill }),
    impact: t('env.cap.skill.impact'),
    fix: t('env.cap.skill.fix', { skill }),
  }
}

/**
 * 能力诊断的一行文案。
 * @param diagnostic - 一项能力诊断。
 * @param t - 当前语言的翻译函数。
 * @returns 显示名、类别、状态；缺失时再带影响与补法。
 */
export function capabilityText(
  diagnostic: CapabilityDiagnostic,
  t: Translate,
): {
  readonly label: string
  readonly category: string
  readonly state: string
  readonly impact: string | null
  readonly fix: string | null
} {
  const staticContent = CAPABILITIES[diagnostic.id]
  const content: CapabilityText | null =
    staticContent === undefined
      ? skillCapabilityContent(diagnostic.id, t)
      : {
          label: t(staticContent.label),
          impact: t(staticContent.impact),
          fix: t(staticContent.fix),
        }
  const missing = diagnostic.status === 'missing'

  return {
    label: content?.label ?? diagnostic.id,
    category: t(
      diagnostic.category === 'host-service'
        ? 'env.category.hostService'
        : 'env.category.uiExtension',
    ),
    state: t(missing ? 'env.state.missing' : 'env.state.present'),
    impact: missing ? (content?.impact ?? null) : null,
    fix: missing ? (content?.fix ?? null) : null,
  }
}
