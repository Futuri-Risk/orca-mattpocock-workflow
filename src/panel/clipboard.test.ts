/**
 * 剪贴板写入的两级路径：剪贴板 API 被权限策略拒绝时，
 * 选中隐藏 textarea 再 `execCommand('copy')` 必须接手；
 * 提示词端口据此回报 copied / manual。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { canCopyText, copyText } from './clipboard.ts'
import { createPromptCopy } from './injection.ts'

interface FakeField {
  value: string
  readOnly: boolean
  tabIndex: number
  readonly style: Record<string, string>
  focus(options?: FocusOptions): void
  select(): void
  setSelectionRange(start: number, end: number): void
  remove(): void
}

interface FakeSelection {
  readonly rangeCount: number
  getRangeAt(index: number): Range
  removeAllRanges(): void
  addRange(range: Range): void
}

interface FakeDocument {
  readonly activeElement: null
  readonly body: { appendChild(node: FakeField): void }
  readonly createElement: () => FakeField
  readonly execCommand: (command: string) => boolean
  readonly getSelection?: () => FakeSelection
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  vi.stubGlobal('navigator', { clipboard: { writeText } })
}

function stubSelectionCopy(
  result: boolean,
  selection?: FakeSelection,
): {
  field: FakeField
  execCommand: (command: string) => boolean
} {
  const field: FakeField = {
    value: '',
    readOnly: false,
    tabIndex: 0,
    style: {},
    focus: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
    remove: vi.fn(),
  }
  const execCommand = vi.fn((_command: string) => result)
  const document: FakeDocument = {
    activeElement: null,
    body: { appendChild: vi.fn() },
    createElement: vi.fn(() => field),
    execCommand,
    ...(selection === undefined ? {} : { getSelection: () => selection }),
  }
  vi.stubGlobal('document', document)
  return { field, execCommand }
}

describe('copyText', () => {
  it('writes with the clipboard API when it is allowed', async () => {
    const writeText = vi.fn(async (_text: string) => {})
    stubClipboard(writeText)
    const { execCommand } = stubSelectionCopy(true)

    await expect(copyText('/implement #2')).resolves.toEqual({ status: 'copied' })
    expect(writeText).toHaveBeenCalledWith('/implement #2')
    expect(execCommand).not.toHaveBeenCalled()
  })

  it('falls back to execCommand when the clipboard API is denied', async () => {
    stubClipboard(async () => {
      throw new Error('NotAllowedError: blocked by permissions policy')
    })
    const { field, execCommand } = stubSelectionCopy(true)

    await expect(copyText('/implement #2')).resolves.toEqual({ status: 'copied' })
    expect(field.value).toBe('/implement #2')
    expect(field.select).toHaveBeenCalled()
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(field.remove).toHaveBeenCalled()
  })

  it('restores the selection the fallback replaced', async () => {
    stubClipboard(async () => {
      throw new Error('NotAllowedError')
    })
    const range = {} as Range
    const selection: FakeSelection = {
      rangeCount: 1,
      getRangeAt: vi.fn(() => range),
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    }
    stubSelectionCopy(true, selection)

    await expect(copyText('/implement #2')).resolves.toEqual({ status: 'copied' })
    expect(selection.removeAllRanges).toHaveBeenCalled()
    expect(selection.addRange).toHaveBeenCalledWith(range)
  })

  it('reports failure when neither path can write', async () => {
    stubClipboard(async () => {
      throw new Error('NotAllowedError')
    })
    stubSelectionCopy(false)

    const outcome = await copyText('/implement #2')
    expect(outcome.status).toBe('failed')
    expect(outcome.message).toContain('复制失败')
  })

  it('uses execCommand when the clipboard API is absent', async () => {
    vi.stubGlobal('navigator', {})
    const { field } = stubSelectionCopy(true)

    await expect(copyText('/implement #2')).resolves.toEqual({ status: 'copied' })
    expect(field.value).toBe('/implement #2')
  })
})

describe('createPromptCopy', () => {
  it('reports copied when the fallback writes the prompt', async () => {
    stubClipboard(async () => {
      throw new Error('NotAllowedError')
    })
    stubSelectionCopy(true)
    const port = createPromptCopy()

    expect(port.canCopy).toBe(true)
    await expect(port.copy('/implement #2')).resolves.toMatchObject({ outcome: 'copied' })
  })

  it('reports manual when both paths fail', async () => {
    stubClipboard(async () => {
      throw new Error('NotAllowedError')
    })
    stubSelectionCopy(false)

    const result = await createPromptCopy().copy('/implement #2')
    expect(result.outcome).toBe('manual')
    expect(result.message).toContain('下面的文本框已全选')
  })
})

describe('canCopyText', () => {
  it('accepts execCommand as a usable path', () => {
    vi.stubGlobal('navigator', {})
    stubSelectionCopy(true)

    expect(canCopyText()).toBe(true)
  })

  it('is false when neither path exists', () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('document', {})

    expect(canCopyText()).toBe(false)
  })
})
