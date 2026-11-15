/**
 * 剪贴板：先调用浏览器剪贴板 API，失败时退回选中文本 + `execCommand('copy')`。
 *
 * Orca 的面板跑在 `sandbox="allow-scripts"` 的 iframe 里，没有 `clipboard-write`
 * 权限策略：`navigator.clipboard.writeText` 会被拒绝（NotAllowedError），而
 * `document.execCommand('copy')` 不受权限策略限制，只要由用户手势触发就能写入。
 * 两条路都失败时把原因交给界面，界面永远保留可全选的只读地址。
 */

/** 一次复制的结果。失败原因用稳定码表示，界面层负责翻成文案。 */
export interface CopyOutcome {
  readonly status: 'copied' | 'failed'
  /** 失败原因码；成功时为 null。 */
  readonly reason: 'unavailable' | null
}

/**
 * 当前环境是否至少有一条写入剪贴板的路径。
 * @returns 剪贴板 API 或 `execCommand` 可用时为 true。
 */
export function canCopyText(): boolean {
  const modern =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'
  const legacy = typeof document !== 'undefined' && typeof document.execCommand === 'function'
  return modern || legacy
}

/**
 * 把文本写入剪贴板。
 * @param text - 要复制的文本。
 * @returns 成功或带原因的失败。
 */
export async function copyText(text: string): Promise<CopyOutcome> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(text)
      return { status: 'copied', reason: null }
    } catch {
      // 多半是权限策略拒绝；继续走 execCommand，别把可用环境判成不可用。
    }
  }

  if (copyWithSelection(text)) return { status: 'copied', reason: null }

  return { status: 'failed', reason: 'unavailable' }
}

/**
 * 用隐藏的 textarea 选中文本再执行 `execCommand('copy')`。
 * @param text - 要复制的文本。
 * @returns 浏览器是否接受这次复制。
 */
function copyWithSelection(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false

  const active = document.activeElement
  const selection = typeof document.getSelection === 'function' ? document.getSelection() : null
  const ranges: Range[] = []
  if (selection !== null) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      ranges.push(selection.getRangeAt(index))
    }
  }

  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.tabIndex = -1
  field.style.position = 'fixed'
  field.style.top = '0'
  field.style.left = '0'
  field.style.width = '1px'
  field.style.height = '1px'
  field.style.padding = '0'
  field.style.border = '0'
  field.style.opacity = '0'
  field.style.pointerEvents = 'none'

  const host = document.body ?? document.documentElement
  host.appendChild(field)
  try {
    field.focus({ preventScroll: true })
    field.select()
    field.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
    const refocus = (active as HTMLElement | null)?.focus
    if (typeof refocus === 'function') refocus.call(active, { preventScroll: true })
    if (selection !== null) {
      try {
        selection.removeAllRanges()
        for (const range of ranges) selection.addRange(range)
      } catch {
        // 选区所在节点已经离开文档时无法还原；复制本身仍按结果返回。
      }
    }
  }
}
