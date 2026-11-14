/**
 * 面板能力探针：剪贴板要按权限策略的真实状态报告，
 * 权限被拒时不能因为 `execCommand` 存在就声称可用。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { probePanelCapabilities } from './capabilities.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubFrame(): void {
  vi.stubGlobal('window', { orca: { plugin: { request: async () => null } } })
}

function stubPermission(state: PermissionState | 'throw'): void {
  vi.stubGlobal('navigator', {
    clipboard: { writeText: async (_text: string) => {} },
    permissions: {
      query: async () => {
        if (state === 'throw') throw new Error('unsupported permission name')
        return { state }
      },
    },
  })
}

describe('probePanelCapabilities', () => {
  it('keeps the bridge and rejects a policy-denied clipboard', async () => {
    stubFrame()
    stubPermission('denied')

    await expect(probePanelCapabilities()).resolves.toEqual({ bridge: true, clipboard: false })
  })

  it('reports a granted clipboard as present', async () => {
    stubFrame()
    stubPermission('granted')

    await expect(probePanelCapabilities()).resolves.toEqual({ bridge: true, clipboard: true })
  })

  it('reports a prompting clipboard as present', async () => {
    stubFrame()
    stubPermission('prompt')

    await expect(probePanelCapabilities()).resolves.toEqual({ bridge: true, clipboard: true })
  })

  it('falls back to path availability when the permission is unsupported', async () => {
    stubFrame()
    stubPermission('throw')

    await expect(probePanelCapabilities()).resolves.toEqual({ bridge: true, clipboard: true })
  })

  it('reports a missing bridge outside Orca', async () => {
    vi.stubGlobal('window', {})
    stubPermission('granted')

    await expect(probePanelCapabilities()).resolves.toEqual({ bridge: false, clipboard: true })
  })
})
