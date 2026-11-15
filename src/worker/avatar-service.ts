/**
 * 头像代理：面板 frame 没有网络权限，`img-src` 只放行 `data:`，所以远端头像地址
 * 不能直接交给 `<img>`。面板把 backend 给出的 http(s) 地址发到这里，worker 下载图片
 * 并转成 data URL 返回，界面才看得见同一张脸。
 *
 * 边界：
 * - 只接受 http(s) 绝对地址，拒绝带凭据的 URL；
 * - 只接受 `image/*` 响应，读取上限 1 MiB、超时 8 秒；
 * - 不缓存图片字节：每次读取都重新下载，用户换头像后刷新就能看到；
 * - 不写磁盘、不进快照：图片只在响应里过一手。
 */
import { normalizeAvatarUrl } from '../core/author.ts'
import { isRecord } from '../core/json.ts'
import {
  ERROR_CODES,
  type AvatarReadResult,
  type ErrorCode,
  type RpcResult,
} from '../protocol/tracker.ts'

/** 头像下载的默认超时。头像不是关键路径，超时就降级成首字母色块。 */
const DEFAULT_TIMEOUT_MS = 8_000
/** 单张头像的读取上限；GitHub / GitLab / Gitea 的头像都远小于这个值。 */
const DEFAULT_MAX_BYTES = 1024 * 1024
/** 下载实现：默认是全局 fetch；测试注入返回固定响应的函数。 */
export type AvatarFetch = (url: string, init: RequestInit) => Promise<Response>

/** 头像服务的依赖；测试注入假的 fetch。 */
export interface AvatarServiceDeps {
  /** 下载实现，默认用 Node 的全局 fetch。 */
  readonly fetchImpl?: AvatarFetch
  readonly timeoutMs?: number
  readonly maxBytes?: number
}

/** worker 侧的头像读取入口。 */
export interface AvatarService {
  /**
   * 把一个远端头像地址读成 data URL。
   * @param params - `{ url }`；地址只允许 http(s) 绝对地址。
   * @param signal - 面板请求的中止信号；面板关闭时停止下载。
   * @returns data URL 或带错误码的失败。
   */
  read(params: unknown, signal?: AbortSignal): Promise<RpcResult<AvatarReadResult>>
}

/**
 * 创建头像代理服务。
 * @param deps - 可注入的 fetch、超时、大小上限与缓存条数。
 * @returns 头像服务。
 */
export function createAvatarService(deps: AvatarServiceDeps = {}): AvatarService {
  const fetchImpl = deps.fetchImpl ?? fetch
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES

  return {
    async read(params, signal) {
      const url = readAvatarUrl(params)
      if (url === null) {
        return failure(ERROR_CODES.invalidParams, '头像地址不是 http(s) 绝对地址。')
      }
      return await loadAvatar(fetchImpl, url, timeoutMs, maxBytes, signal)
    },
  }
}

/** 读出并校验请求里的 URL：必须是 http(s) 绝对地址，且不能带用户名密码。 */
function readAvatarUrl(params: unknown): string | null {
  if (!isRecord(params)) return null
  const value = params['url']
  if (typeof value !== 'string') return null

  const normalized = normalizeAvatarUrl(value)
  if (normalized === null) return null

  const url = new URL(normalized)
  if (url.username.length > 0 || url.password.length > 0) return null
  return url.toString()
}

/** 下载一张头像并转成 data URL。失败只回错误，不抛给 RPC 桥。 */
async function loadAvatar(
  fetchImpl: AvatarFetch,
  url: string,
  timeoutMs: number,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<RpcResult<AvatarReadResult>> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  const abort = (): void => {
    controller.abort()
  }
  signal?.addEventListener('abort', abort, { once: true })

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'image/*' },
    })
    if (!response.ok) return failure(ERROR_CODES.fetchFailed, `读取头像失败：HTTP ${response.status}`)

    const mime = readImageMime(response.headers.get('content-type'))
    if (mime === null) return failure(ERROR_CODES.fetchFailed, '远端返回的不是图片。')

    const bytes = await readBody(response, maxBytes)
    if (bytes === null) return failure(ERROR_CODES.fetchFailed, '头像文件过大或读取失败。')

    return {
      ok: true,
      result: { dataUrl: `data:${mime};base64,${bytes.toString('base64')}` },
    }
  } catch {
    return failure(ERROR_CODES.fetchFailed, '读取头像失败。')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

/** 只接受 `image/*`；去掉参数并转小写，避免 `image/PNG; charset=…` 这种写法被漏掉。 */
function readImageMime(header: string | null): string | null {
  if (header === null) return null
  const mime = header.split(';')[0]?.trim().toLowerCase() ?? ''
  return /^image\/[a-z0-9.+-]+$/.test(mime) ? mime : null
}

/** 按块读取响应体，超过上限立即取消；`content-length` 缺失或撒谎也不影响上限。 */
async function readBody(response: Response, maxBytes: number): Promise<Buffer | null> {
  const body = response.body
  if (body === null) return null

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue

      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }

  return Buffer.concat(chunks)
}

function failure(code: ErrorCode, message: string): RpcResult<AvatarReadResult> {
  return { ok: false, error: { code, message } }
}
