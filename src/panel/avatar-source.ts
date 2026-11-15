/**
 * 头像的异步来源。面板 frame 没有网络，远端头像地址本身不能交给 `<img>`：
 * 这里统一向 worker 要 data URL。
 *
 * 只做并发去重：同一 URL 同时挂载的多个头像共享一次请求，请求结束就丢掉结果。
 * 不保留图片字节，刷新后重新取，用户换头像能立即看到；也不写存储、不随快照落盘。
 */
import type { AvatarReadResult, RpcResult } from '../protocol/tracker.ts'

/** 把远端头像地址解析成可渲染的 data URL；解析不出来时为 null。 */
export type AvatarSourceLoader = (url: string) => Promise<string | null>

/** 加载器只依赖客户端这一个方法，测试可以注入假实现。 */
export interface AvatarSourceClient {
  readAvatar(url: string): Promise<RpcResult<AvatarReadResult>>
}

/**
 * 创建头像加载器。
 * @param client - 负责向 worker 请求头像的客户端。
 * @returns 按 URL 去重的加载器。
 */
export function createAvatarSourceLoader(client: AvatarSourceClient): AvatarSourceLoader {
  const inflight = new Map<string, Promise<string | null>>()

  return (url) => {
    const running = inflight.get(url)
    if (running !== undefined) return running

    const task = client.readAvatar(url).then(
      (result) => (result.ok ? result.result.dataUrl : null),
      () => null,
    )
    inflight.set(url, task)
    void task.finally(() => {
      if (inflight.get(url) === task) inflight.delete(url)
    })
    return task
  }
}
