import { describe, expect, it } from 'vitest'

import { createAvatarService, type AvatarFetch } from './avatar-service.ts'

/** 1×1 PNG 的字节，足够证明响应被原样转成 data URL。 */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 记录调用次数并返回一张 PNG。 */
function pngFetch(calls: string[] = []): AvatarFetch {
  return async (url) => {
    calls.push(url)
    return new Response(PNG, { headers: { 'content-type': 'image/png' } })
  }
}

describe('worker 头像代理', () => {
  it('把远端图片转成 data URL', async () => {
    const service = createAvatarService({ fetchImpl: pngFetch() })

    const result = await service.read({ url: 'https://avatars.githubusercontent.com/u/1?v=4' })

    expect(result).toEqual({
      ok: true,
      result: { dataUrl: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}` },
    })
  })

  it('不保留图片字节：每次读取都重新下载', async () => {
    const calls: string[] = []
    const service = createAvatarService({ fetchImpl: pngFetch(calls) })
    const params = { url: 'https://example.com/avatar.png' }

    await service.read(params)
    await service.read(params)

    expect(calls).toHaveLength(2)
  })

  it('拒绝非 http(s) 地址与相对路径', async () => {
    const calls: string[] = []
    const service = createAvatarService({ fetchImpl: pngFetch(calls) })

    await expect(service.read({ url: 'javascript:alert(1)' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-params' },
    })
    await expect(service.read({ url: 'data:image/png;base64,AAAA' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-params' },
    })
    await expect(service.read({ url: '/avatars/1.png' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-params' },
    })
    await expect(service.read({ url: 42 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-params' },
    })
    expect(calls).toHaveLength(0)
  })

  it('拒绝带凭据的地址', async () => {
    const service = createAvatarService({ fetchImpl: pngFetch() })

    const result = await service.read({ url: 'https://user:secret@example.com/avatar.png' })

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-params' } })
  })

  it('非图片响应按失败处理', async () => {
    const service = createAvatarService({
      fetchImpl: async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
    })

    const result = await service.read({ url: 'https://example.com/avatar.png' })

    expect(result).toMatchObject({ ok: false, error: { code: 'fetch-failed' } })
  })

  it('超过上限的响应被拒绝', async () => {
    const service = createAvatarService({
      fetchImpl: async () =>
        new Response(new Uint8Array(64), { headers: { 'content-type': 'image/png' } }),
      maxBytes: 16,
    })

    const result = await service.read({ url: 'https://example.com/avatar.png' })

    expect(result).toMatchObject({ ok: false, error: { code: 'fetch-failed' } })
  })

  it('HTTP 失败与网络异常都折成 fetch-failed', async () => {
    const failing = createAvatarService({
      fetchImpl: async () => new Response('not found', { status: 404 }),
    })
    const throwing = createAvatarService({
      fetchImpl: async () => {
        throw new Error('offline')
      },
    })

    await expect(throwing.read({ url: 'https://example.com/a.png' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed' },
    })
    await expect(failing.read({ url: 'https://example.com/a.png' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed' },
    })
  })

  it('失败不缓存：下一次请求会重新下载', async () => {
    let attempts = 0
    const service = createAvatarService({
      fetchImpl: async () => {
        attempts += 1
        return attempts === 1
          ? new Response('nope', { status: 500 })
          : new Response(PNG, { headers: { 'content-type': 'image/png' } })
      },
    })
    const params = { url: 'https://example.com/avatar.png' }

    await service.read(params)
    const second = await service.read(params)

    expect(attempts).toBe(2)
    expect(second.ok).toBe(true)
  })

  it('面板关闭时中止下载', async () => {
    const service = createAvatarService({
      fetchImpl: async (_url, init) => {
        // ES2023 的 lib 没有 Promise.withResolvers，这里用执行器形式等中止信号。
        return await new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        })
      },
    })
    const controller = new AbortController()
    const pending = service.read({ url: 'https://example.com/avatar.png' }, controller.signal)

    controller.abort()

    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'fetch-failed' } })
  })
})
