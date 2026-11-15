/**
 * 解决区的文案与动作类型。protocol 只送解决码和对象，
 * 每个码对应的文案、动作与链接只在这里维护。
 *
 * 表是全覆盖的 `Record<EnvRemedyCode, …>`：新增解决码忘了写文案时，
 * 类型检查会失败，不会出现「有码无文案」。
 */
import type { BackendKind } from '../protocol/backend.ts'
import { PANEL_SKILLS, type EnvCliBackend, type EnvRemedyCode } from '../protocol/env-check.ts'
import type { Translate } from './i18n.ts'

/** 解决区渲染所需的上下文。 */
export interface RemedyContext {
  readonly backend: BackendKind | null
  /** 后端判定出的仓库标识；本地 Markdown 或判定失败时为 null。 */
  readonly repository: string | null
  /** 解决对象：技能名或后端名，已按 `remedy.subject ?? item.subject` 解析。 */
  readonly subject: string | null
  /** 失败项的标题。 */
  readonly title: string
  /** 失败项的判定依据：只含结论，不含命令原始输出。 */
  readonly detail: string
}

/** 解决的动作类型：复制提示词、命令或重试。 */
export type RemedyAction =
  | { readonly kind: 'prompt'; readonly prompt: string }
  | { readonly kind: 'install-skill'; readonly skill: string }
  | { readonly kind: 'command'; readonly command: string }
  | { readonly kind: 'retry' }

/** 解决区的文案：摘要、动作与可选的次要链接。 */
export interface RemedyContent {
  readonly summary: string
  readonly action: RemedyAction
  readonly link?: { readonly href: string; readonly label: string }
}

interface CliText {
  readonly label: string
  readonly install: string
  readonly login: string
  readonly installUrl: string
}

const CLI: Readonly<Record<EnvCliBackend, CliText>> = {
  github: {
    label: 'GitHub CLI (gh)',
    install: 'brew install gh',
    login: 'gh auth login',
    installUrl: 'https://cli.github.com',
  },
  gitlab: {
    label: 'GitLab CLI (glab)',
    install: 'brew install glab',
    login: 'glab auth login',
    installUrl: 'https://gitlab.com/gitlab-org/cli',
  },
  gitea: {
    label: 'Gitea CLI (tea)',
    install: 'brew install tea',
    login: 'tea login add',
    installUrl: 'https://gitea.com/gitea/tea',
  },
}

const SKILLS_REPO = 'https://github.com/mattpocock/skills'

/** Orca 官方下载页；本机命令行缺失时先给出安装入口。 */
const ORCA_SITE = 'https://www.onorca.dev'

function cliOf(subject: string | null): CliText | undefined {
  return subject === 'github' || subject === 'gitlab' || subject === 'gitea'
    ? CLI[subject]
    : undefined
}

/** 不知道后端时列出全部 CLI 的同一类命令，命令本身仍只从 CLI 表取。 */
function allCliCommands(pick: (cli: CliText) => string): string {
  return Object.values(CLI)
    .map((cli) => `${pick(cli)}  # ${cli.label}`)
    .join('\n')
}

function installCommand(subject: string | null): string {
  return cliOf(subject)?.install ?? allCliCommands((cli) => cli.install)
}

function loginCommand(subject: string | null): string {
  return cliOf(subject)?.login ?? allCliCommands((cli) => cli.login)
}

/** 只把形如 `owner/name`、`group/sub/name` 的仓库路径拼进命令，避免远端里的 shell 元字符被复制执行。 */
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/

function repositoryArg(repository: string | null): string {
  return repository !== null && SAFE_REPOSITORY.test(repository) ? ` ${repository}` : ''
}

/** 仓库权限核对命令：知道后端和仓库名时点名具体仓库。 */
function repositoryCommand(context: RemedyContext): string {
  const arg = repositoryArg(context.repository)
  if (context.backend === 'github') {
    return `gh repo view${arg} --json nameWithOwner,viewerPermission`
  }
  if (context.backend === 'gitlab') {
    return `glab repo view${arg}`
  }
  return 'git remote -v'
}

const REMEDIES: Readonly<
  Record<EnvRemedyCode, (context: RemedyContext, t: Translate) => RemedyContent>
> = {
  'install-cli': (context, t) => {
    const cli = cliOf(context.subject)
    return {
      summary:
        cli === undefined
          ? t('env.remedy.installCli.unnamed')
          : t('env.remedy.installCli.named', { cli: cli.label }),
      action: { kind: 'command', command: installCommand(context.subject) },
      ...(cli === undefined
        ? {}
        : {
            link: {
              href: cli.installUrl,
              label: t('env.remedy.installCli.link', { cli: cli.label }),
            },
          }),
    }
  },
  'install-orca': (_context, t) => ({
    summary: t('env.remedy.installOrca.summary'),
    action: { kind: 'command', command: 'export ORCA_CLI_COMMAND=/path/to/orca' },
    link: { href: ORCA_SITE, label: t('env.remedy.installOrca.link') },
  }),
  'login-cli': (context, t) => {
    const cli = cliOf(context.subject)
    return {
      summary:
        cli === undefined
          ? t('env.remedy.loginCli.unnamed')
          : t('env.remedy.loginCli.named', { cli: cli.label }),
      action: { kind: 'command', command: loginCommand(context.subject) },
    }
  },
  'install-skill': (context, t) => {
    const skill = context.subject ?? t('env.remedy.installSkill.unknown')
    return {
      summary: t('env.remedy.installSkill.summary', { skill }),
      action: { kind: 'install-skill', skill },
      link: { href: SKILLS_REPO, label: t('env.remedy.installSkill.link') },
    }
  },
  'init-workspace': (context, t) => ({
    summary: t('env.remedy.initWorkspace.summary', { skill: PANEL_SKILLS.setup }),
    action: {
      kind: 'prompt',
      prompt: [
        `/${PANEL_SKILLS.setup}`,
        '',
        t('env.remedy.initWorkspace.prompt', {
          title: context.title,
          detail: context.detail,
        }),
        t('env.remedy.initWorkspace.promptTail'),
      ].join('\n'),
    },
  }),
  'place-local-issues': (context, t) => ({
    summary: t('env.remedy.placeLocalIssues.summary'),
    action: {
      kind: 'prompt',
      prompt: t('env.remedy.placeLocalIssues.prompt', {
        title: context.title,
        detail: context.detail,
      }),
    },
  }),
  'check-repository-access': (context, t) => ({
    summary: t('env.remedy.checkRepositoryAccess.summary', {
      repository: context.repository ?? t('env.remedy.remoteRepository'),
    }),
    action: { kind: 'command', command: repositoryCommand(context) },
  }),
  'check-remote-address': (_context, t) => ({
    summary: t('env.remedy.checkRemoteAddress.summary'),
    action: { kind: 'command', command: 'git remote -v' },
  }),
  'check-network': (_context, t) => ({
    summary: t('env.remedy.checkNetwork.summary'),
    action: { kind: 'retry' },
  }),
  'check-home': (_context, t) => ({
    summary: t('env.remedy.checkHome.summary'),
    action: { kind: 'command', command: 'printenv HOME' },
  }),
  'check-logs': (_context, t) => ({
    summary: t('env.remedy.checkLogs.summary', { logs: t('env.remedy.hostLogs') }),
    action: { kind: 'retry' },
  }),
  'fix-backend': (context, t) => ({
    summary: t('env.remedy.fixBackend.summary'),
    action: {
      kind: 'prompt',
      prompt: t('env.remedy.fixBackend.prompt', {
        title: context.title,
        detail: context.detail,
      }),
    },
  }),
  retry: (_context, t) => ({
    summary: t('env.remedy.retry.summary', { logs: t('env.remedy.hostLogs') }),
    action: { kind: 'retry' },
  }),
}

/**
 * 取一条解决的文案与动作。
 * @param code - 解决码。
 * @param context - 后端、仓库、对象与失败项信息。
 * @param t - 当前语言的翻译函数。
 * @returns 摘要、动作与可选链接。
 */
export function remedyContent(
  code: EnvRemedyCode,
  context: RemedyContext,
  t: Translate,
): RemedyContent {
  return REMEDIES[code](context, t)
}
