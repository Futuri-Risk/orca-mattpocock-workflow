import { describe, expect, it } from 'vitest'

import type { AvatarReadResult, RpcResult } from '../protocol/tracker.ts'
import { createAvatarSourceLoader, type AvatarSourceClient } from './avatar-source.ts'

/** 按 URL 返回固定结果的假客户端，并记录调用次数。 */
function fakeClient(
  answer: (url: string) => RpcResult<AvatarReadResult>,
): AvatarSourceClient & { readonly calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    readAvatar: (url) => {
      calls.push(url)
      return Promise.resolve(answer(url))
    },
  }
}

describe('头像加载器', () => {
  it('把 worker 返回的 data URL 交给组件', async () => {
    const client = fakeClient(() => ({
      ok: true,
      result: { dataUrl: 'data:image/png;base64,AAAA' },
    }))
    const load = createAvatarSourceLoader(client)

    await expect(load('https://example.com/a.png')).resolves.toBe('data:image/png;base64,AAAA')
  })

  it('并发挂载的同一地址只请求一次', async () => {
    const client = fakeClient(() => ({
      ok: true,
      result: { dataUrl: 'data:image/png;base64,AAAA' },
    }))
    const load = createAvatarSourceLoader(client)

    const [first, second] = await Promise.all([
      load('https://example.com/a.png'),
      load('https://example.com/a.png'),
    ])

    expect([first, second]).toEqual(['data:image/png;base64,AAAA', 'data:image/png;base64,AAAA'])
    expect(client.calls).toEqual(['https://example.com/a.png'])
  })

  it('请求结束后不留图片字节：再取会重新请求', async () => {
    const client = fakeClient(() => ({
      ok: true,
      result: { dataUrl: 'data:image/png;base64,AAAA' },
    }))
    const load = createAvatarSourceLoader(client)

    await load('https://example.com/a.png')
    await load('https://example.com/a.png')

    expect(client.calls).toHaveLength(2)
  })

  it('失败与异常都降级成 null', async () => {
    const failed = fakeClient(() => ({
      ok: false,
      error: { code: 'fetch-failed', message: '离线' },
    }))
    const throwing: AvatarSourceClient = {
      readAvatar: () => Promise.reject(new Error('bridge down')),
    }

    await expect(createAvatarSourceLoader(failed)('https://example.com/a.png')).resolves.toBeNull()
    await expect(createAvatarSourceLoader(throwing)('https://example.com/b.png')).resolves.toBeNull()
    expect(failed.calls).toHaveLength(1)
  })
})
