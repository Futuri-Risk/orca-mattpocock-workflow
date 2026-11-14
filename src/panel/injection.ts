/**
 * 提示词出口：Orca 侧没有「往会话输入框填字」和「开新会话」两条路径，
 * 面板只把提示词交给剪贴板，由用户自己粘到任意 agent 会话。
 *
 * 剪贴板写失败时不静默：结果回报给界面，界面展示一个只读、已全选的文本框，
 * 用户按 ⌘C 手动复制。
 */
import * as React from 'react'

/** 一次复制的结果。 */
export type CopyOutcome =
  /** 已写进剪贴板。 */
  | 'copied'
  /** 剪贴板不可用或被拒绝，需要手动复制。 */
  | 'manual'

/** 复制结果与给用户看的说明。 */
export interface CopyResult {
  readonly outcome: CopyOutcome
  readonly message: string
}

/** 面板的提示词复制端口。 */
export interface PromptCopy {
  /** 剪贴板 API 是否可用；不可用时界面直接给出手动复制区。 */
  readonly canCopy: boolean
  /**
   * 复制一段提示词。
   * @param text - 要复制的提示词。
   * @returns 复制结果；失败时 outcome 为 manual，界面据此展示手动复制区。
   */
  copy(text: string): Promise<CopyResult>
}

/** 复制反馈的色调：成功是信息，手动复制也是信息（用户还能自己复制）。 */
export type NoticeTone = 'info' | 'error'

/** 复制状态：提示文案、语气与需要手动复制时的文本。 */
export interface PromptCopyState {
  readonly notice: string | null
  readonly noticeTone: NoticeTone | null
  /** 需要手动复制的文本；null 表示不需要。 */
  readonly manual: string | null
}

/** 复制状态与三个操作入口。 */
export interface PromptCopyControls {
  readonly state: PromptCopyState
  /** 复制一段提示词并更新反馈；返回复制结果，调用方据此更新自己的标记。 */
  readonly copy: (text: string) => Promise<CopyResult>
  /** 直接展示手动复制区，跳过剪贴板。 */
  readonly showManual: (text: string) => void
  /** 清掉当前反馈。 */
  readonly dismiss: () => void
}

/**
 * 剪贴板是否可用。webview 里 navigator.clipboard 可能缺席。
 * @returns 能否调用 writeText。
 */
export function isClipboardAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.writeText === 'function'
  )
}

/** 手动复制时的统一提示。 */
const MANUAL_HINT = '下面的文本框已全选，按 ⌘C 复制。'

/**
 * 创建复制端口。
 * @returns 走剪贴板的复制端口；剪贴板不可用时直接回报手动复制。
 */
export function createPromptCopy(): PromptCopy {
  return {
    // 用取值器而不是快照：剪贴板能力可能在面板运行后才就绪。
    get canCopy(): boolean {
      return isClipboardAvailable()
    },
    copy: async (text) => {
      if (!isClipboardAvailable()) {
        return { outcome: 'manual', message: MANUAL_HINT }
      }
      try {
        await navigator.clipboard.writeText(text)
        return { outcome: 'copied', message: '提示词已复制到剪贴板，粘贴到会话里即可使用。' }
      } catch (error) {
        const detail = error instanceof Error ? error.message : '未知错误'
        return { outcome: 'manual', message: `复制失败：${detail}。${MANUAL_HINT}` }
      }
    },
  }
}

/** 面板共用一个复制端口。 */
export const promptCopy: PromptCopy = createPromptCopy()

/**
 * 把复制端口接到 React 状态。
 * @param port - 面板的复制端口。
 * @returns 当前状态与复制、显示手动复制区、清空三个入口。
 */
export function usePromptCopy(port: PromptCopy): PromptCopyControls {
  const [state, setState] = React.useState<PromptCopyState>({
    notice: null,
    noticeTone: null,
    manual: null,
  })

  const copy = React.useCallback(
    (text: string): Promise<CopyResult> =>
      port.copy(text).then((result) => {
        setState({
          notice: result.message,
          noticeTone: result.outcome === 'copied' ? 'info' : 'error',
          manual: result.outcome === 'manual' ? text : null,
        })
        return result
      }),
    [port],
  )

  const showManual = React.useCallback((text: string): void => {
    setState({ notice: MANUAL_HINT, noticeTone: 'info', manual: text })
  }, [])

  const dismiss = React.useCallback((): void => {
    setState({ notice: null, noticeTone: null, manual: null })
  }, [])

  return { state, copy, showManual, dismiss }
}
