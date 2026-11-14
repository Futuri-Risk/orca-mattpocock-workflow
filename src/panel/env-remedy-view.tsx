/**
 * 解决区：失败项依据下面的一段可执行做法。
 * 按动作类型渲染可复制的提示词、可复制命令或重试按钮；文案来自 env-remedy-text。
 */
import * as React from 'react'

import type { EnvCheckItem, EnvCheckReport } from '../protocol/env-check.ts'
import type { RpcResult } from '../protocol/tracker.ts'
import { copyText } from './clipboard.ts'
import {
  ENV_COMMAND_STYLE,
  ENV_DETAIL_STYLE,
  ENV_REMEDY_ACTIONS_STYLE,
  ENV_REMEDY_COMMAND_WRAP_STYLE,
  ENV_REMEDY_LINK_STYLE,
  ENV_REMEDY_NOTICE_STYLE,
  ENV_REMEDY_STYLE,
} from './env-check-styles.ts'
import { envCheckTitle } from './env-check-text.ts'
import { usePromptCopy, type PromptCopy } from './injection.ts'
import { PromptCopyArea } from './prompt-copy.tsx'
import { remedyContent, type RemedyAction } from './env-remedy-text.ts'
import { installSkills, type SkillsInstallResult } from './transport.ts'
import { BUTTON_STYLE } from './task-panel-styles.ts'

/** 解决动作需要的界面能力与回调。 */
export interface RemedyHandlers {
  /** 面板的提示词复制端口。 */
  readonly copy: PromptCopy
  readonly busy: boolean
  readonly onRetry: () => void
}

/**
 * 失败项的解决区；没有解决时不渲染。
 * @param props - 失败项、报告上下文与动作回调。
 * @returns 摘要、动作与可选链接。
 */
export function RemedySection(props: {
  readonly item: EnvCheckItem
  readonly report: EnvCheckReport
  readonly handlers: RemedyHandlers
}): React.ReactElement | null {
  const remedy = props.item.remedy
  if (remedy === null) return null

  const content = remedyContent(remedy.code, {
    backend: props.report.backend,
    repository: props.report.repository,
    subject: remedy.subject ?? props.item.subject,
    title: envCheckTitle(props.item),
    detail: props.item.detail,
  })

  return (
    <div data-testid="env-remedy" data-code={remedy.code} style={ENV_REMEDY_STYLE}>
      <div data-testid="env-remedy-summary" style={ENV_DETAIL_STYLE}>
        {content.summary}
      </div>
      <RemedyActionView action={content.action} handlers={props.handlers} />
      {content.link === undefined ? null : (
        <a
          data-testid="env-remedy-link"
          href={content.link.href}
          target="_blank"
          rel="noreferrer"
          style={ENV_REMEDY_LINK_STYLE}
        >
          {content.link.label}
        </a>
      )}
    </div>
  )
}

function RemedyActionView(props: {
  readonly action: RemedyAction
  readonly handlers: RemedyHandlers
}): React.ReactElement {
  switch (props.action.kind) {
    case 'command':
      return (
        <div style={ENV_REMEDY_COMMAND_WRAP_STYLE}>
          <pre data-testid="env-remedy-command" tabIndex={0} style={ENV_COMMAND_STYLE}>
            <code>{props.action.command}</code>
          </pre>
          <CopyButton
            text={props.action.command}
            label="复制命令"
            noun="命令"
            testId="env-remedy-copy-command"
          />
        </div>
      )
    case 'prompt':
      return <PromptAction prompt={props.action.prompt} copy={props.handlers.copy} />
    case 'install-skill':
      return <InstallSkillAction skill={props.action.skill} />
    case 'retry':
      return (
        <button
          type="button"
          data-testid="env-remedy-retry"
          disabled={props.handlers.busy}
          onClick={props.handlers.onRetry}
          style={BUTTON_STYLE}
        >
          {props.handlers.busy ? '检查中…' : '重新检查'}
        </button>
      )
  }
}

/** 安装技能：交给 worker 装到宿主扫描的技能目录，并把结果说清楚。 */
function InstallSkillAction(props: { readonly skill: string }): React.ReactElement {
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<string | null>(null)

  return (
    <div style={ENV_REMEDY_ACTIONS_STYLE}>
      <button
        type="button"
        data-testid="env-remedy-install-skill"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void installSkills().then((outcome) => {
            setBusy(false)
            setResult(installSummary(outcome))
          })
        }}
        style={BUTTON_STYLE}
      >
        {busy ? '安装中…' : `安装 ${props.skill}`}
      </button>
      {result === null ? null : (
        <span role="status" data-testid="env-remedy-install-result" style={ENV_REMEDY_NOTICE_STYLE}>
          {result}
        </span>
      )}
    </div>
  )
}

/** 安装结果的说明：装成功几个、失败几个、失败的原因。 */
function installSummary(outcome: RpcResult<SkillsInstallResult>): string {
  if (!outcome.ok) return `安装失败：${outcome.error.message}`
  const { installed, failed } = outcome.result
  if (failed.length === 0) return `已安装 ${String(installed.length)} 个技能。`
  const reason = failed[0]?.reason ?? '未知原因'
  return `已安装 ${String(installed.length)} 个技能，${String(failed.length)} 个失败：${reason}`
}

/** 解决提示词：复制到剪贴板，或展开只读的手动复制区。 */
function PromptAction(props: {
  readonly prompt: string
  readonly copy: PromptCopy
}): React.ReactElement {
  const { state, copy, showManual, dismiss } = usePromptCopy(props.copy)

  return (
    <div style={ENV_REMEDY_ACTIONS_STYLE}>
      <button
        type="button"
        data-testid="env-remedy-copy-prompt"
        aria-label="复制提示词"
        disabled={!props.copy.canCopy}
        onClick={() => {
          void copy(props.prompt)
        }}
        style={BUTTON_STYLE}
      >
        复制提示词
      </button>
      <button
        type="button"
        data-testid="env-remedy-manual-prompt"
        aria-label="手动复制提示词"
        onClick={() => {
          showManual(props.prompt)
        }}
        style={BUTTON_STYLE}
      >
        手动复制
      </button>
      <div style={{ flexBasis: '100%' }}>
        <PromptCopyArea state={state} onDismiss={dismiss} />
      </div>
    </div>
  )
}

function CopyButton(props: {
  readonly text: string
  readonly label: string
  readonly noun: string
  readonly testId: string
}): React.ReactElement {
  const [state, setState] = React.useState<'idle' | 'copied' | 'failed'>('idle')

  React.useEffect(() => {
    if (state === 'idle') return undefined
    const timer = window.setTimeout(() => {
      setState('idle')
    }, 1500)
    return () => {
      window.clearTimeout(timer)
    }
  }, [state])

  return (
    <div style={ENV_REMEDY_ACTIONS_STYLE}>
      <button
        type="button"
        data-testid={props.testId}
        onClick={() => {
          void copyText(props.text).then((result) => {
            setState(result.status === 'copied' ? 'copied' : 'failed')
          })
        }}
        style={BUTTON_STYLE}
      >
        {state === 'copied' ? '已复制' : props.label}
      </button>
      {state === 'failed' ? (
        <span role="status" data-testid={`${props.testId}-failed`} style={ENV_REMEDY_NOTICE_STYLE}>
          复制失败，请手动选择{props.noun}。
        </span>
      ) : null}
    </div>
  )
}

