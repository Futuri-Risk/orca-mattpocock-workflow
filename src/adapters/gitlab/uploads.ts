/**
 * GitLab Markdown 上传附件的内联。
 *
 * GitLab 在 issue / note 正文里把上传附件写成根相对图片
 * `![alt](/uploads/<secret>/<filename>)`。面板 frame 的 CSP 只放行 `data:` 图片，
 * 私有项目的附件又必须带鉴权才能取到字节，所以宿主用当前工作区已登录的 `glab`
 * 取回原始字节，把图片地址换成 data URL；失败时换成指向 GitLab 原链接的普通链接，
 * 面板里不会出现裸破图。
 *
 * 边界：
 * - 只处理当前工作区项目的附件：相对 `/uploads/<secret>/<filename>`，
 *   或同源、同项目路径的绝对地址；其它相对地址与外链原样保留；
 * - 只接受位图（PNG / JPEG / GIF / WebP / BMP），其它响应按失败降级；
 * - 单张与单次详情都有大小上限，超过即降级为链接；
 * - token 由 `glab` 自己注入，不进参数、不进输出、不进日志。
 */
import { Buffer } from 'node:buffer'

import type { BinaryCommandRunner } from '../../core/ticket.ts'
import { projectEndpoint } from './shared.ts'

/** 单张附件的大小上限；超过就降级成链接，避免详情响应被单张图撑爆。 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
/** 一次详情（正文 + 全部评论）累计内联的字节上限；其余图片降级成链接。 */
export const MAX_TOTAL_UPLOAD_BYTES = 12 * 1024 * 1024

/** 内联器依赖：项目身份与取字节的执行器。 */
export interface UploadInlinerDeps {
  /** 取附件字节；只接受二进制输出。 */
  readonly run: BinaryCommandRunner
  /** 工作区根目录，作为 `glab` 的 cwd。 */
  readonly workspaceRoot: string
  /**
   * GitLab 实例根地址，例如 `https://gitlab.example.com`；
   * 子路径安装时带前缀（`https://example.com/gitlab`），端口保留。
   */
  readonly instanceUrl: string
  /** 当前工作区的项目完整路径，含嵌套 group。 */
  readonly project: string
  readonly maxBytes?: number
  readonly maxTotalBytes?: number
}

/** 一个正文 / 评论共用的内联器；同一张图只取一次。 */
export interface UploadInliner {
  /**
   * 把 Markdown 里属于当前项目的上传图片换成 data URL。
   * @param markdown - 原文。
   * @returns 改写后的 Markdown；失败项已降级为链接。
   */
  inline(markdown: string): Promise<string>
}

/** `/uploads/<secret>/<filename>` 里取出来的两段。 */
interface UploadRef {
  readonly secret: string
  readonly filename: string
}

/** 一张图的取图结果：成功是 data URL，失败是原链接。 */
interface UploadOutcome {
  readonly dataUrl: string | null
  readonly fallbackUrl: string
}

/** 行内图片语法；与面板渲染器一样允许地址里有一层括号。 */
const IMAGE_TOKEN = /!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/g

/**
 * 创建内联器。同一个实例里缓存取图结果，正文与评论命中同一张图时不再重复请求。
 * @param deps - 项目身份、执行器与上限。
 * @returns 内联器。
 */
export function createUploadInliner(deps: UploadInlinerDeps): UploadInliner {
  const maxBytes = deps.maxBytes ?? MAX_UPLOAD_BYTES
  const maxTotalBytes = deps.maxTotalBytes ?? MAX_TOTAL_UPLOAD_BYTES
  const outcomes = new Map<string, UploadOutcome>()
  const base = readInstanceBase(deps.instanceUrl)
  let usedBytes = 0

  async function fetchOutcome(ref: UploadRef): Promise<UploadOutcome> {
    const fallbackUrl = uploadUrl(deps.instanceUrl, deps.project, ref)
    try {
      const output = await deps.run('glab', ['api', uploadEndpoint(deps.project, ref)], {
        cwd: deps.workspaceRoot,
      })
      const bytes = output.stdout
      // 先按单张上限判，再按累计上限判：两者任一超出都只降级这张图。
      if (bytes.byteLength > maxBytes) return { dataUrl: null, fallbackUrl }
      const mime = imageMime(bytes)
      if (mime === null) return { dataUrl: null, fallbackUrl }
      if (usedBytes + bytes.byteLength > maxTotalBytes) return { dataUrl: null, fallbackUrl }

      usedBytes += bytes.byteLength
      return {
        dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
        fallbackUrl,
      }
    } catch {
      // 权限、404、超时都不让详情失败：这一张图退回链接。
      return { dataUrl: null, fallbackUrl }
    }
  }

  async function replacementFor(token: string, alt: string, raw: string): Promise<string> {
    const ref = base === null ? null : resolveUpload(raw, base, deps.project)
    if (ref === null) return token

    const key = `${ref.secret}\u0000${ref.filename}`
    let outcome = outcomes.get(key)
    if (outcome === undefined) {
      outcome = await fetchOutcome(ref)
      outcomes.set(key, outcome)
    }

    if (outcome.dataUrl !== null) return `![${alt}](${outcome.dataUrl})`
    const label = alt.trim().length === 0 ? ref.filename : alt
    return `[${label}](${outcome.fallbackUrl})`
  }

  /** 逐行处理；代码围栏里的示例图片不动，免得把文档内容替换掉。 */
  async function inlineLine(line: string): Promise<string> {
    const matches = [...line.matchAll(IMAGE_TOKEN)]
    if (matches.length === 0) return line

    const parts: string[] = []
    let cursor = 0
    for (const match of matches) {
      const index = match.index ?? 0
      const token = match[0]
      const alt = match[1] ?? ''
      const raw = (match[2] ?? '').trim()
      parts.push(line.slice(cursor, index), await replacementFor(token, alt, raw))
      cursor = index + token.length
    }
    parts.push(line.slice(cursor))
    return parts.join('')
  }

  return {
    async inline(markdown) {
      const lines = markdown.split('\n')
      const out: string[] = []
      let inFence = false

      for (const line of lines) {
        if (/^\s*```/.test(line)) {
          inFence = !inFence
          out.push(line)
          continue
        }
        out.push(inFence ? line : await inlineLine(line))
      }
      return out.join('\n')
    },
  }
}

/** GitLab 实例根：源与可能存在的子路径前缀（根安装时为空串）。 */
interface InstanceBase {
  readonly origin: string
  readonly path: string
}

/**
 * 解析实例根地址。
 * @param instanceUrl - 形如 `https://host/gitlab` 的地址。
 * @returns 源与规范化后的子路径；不合法时是 null（此时不内联任何图片）。
 */
function readInstanceBase(instanceUrl: string): InstanceBase | null {
  let url: URL
  try {
    url = new URL(instanceUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return { origin: url.origin, path: url.pathname.replace(/\/+$/, '') }
}

/**
 * 把正文里的图片地址解析成当前项目的附件定位。
 * @param raw - Markdown 里的图片地址。
 * @param base - 实例根。
 * @param project - 当前项目完整路径。
 * @returns 附件定位；不属于当前项目时是 null。
 */
function resolveUpload(raw: string, base: InstanceBase, project: string): UploadRef | null {
  const relative = /^\/uploads\/([^/?#]+)\/([^/?#]+)$/.exec(raw)
  if (relative !== null) return readRef(relative[1], relative[2])

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username !== '' || url.password !== '') return null
  if (url.origin !== base.origin) return null
  if (url.search !== '' || url.hash !== '') return null

  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  const prefix = `${base.path}/${project}/uploads/`
  if (!pathname.startsWith(prefix)) return null

  const segments = pathname.slice(prefix.length).split('/')
  if (segments.length !== 2) return null
  return readRef(segments[0], segments[1])
}

/** 两段都必须是非空、无分隔符、非 `.` / `..` 的字面量。 */
function readRef(
  secret: string | undefined,
  filename: string | undefined,
): UploadRef | null {
  if (!isSafeSegment(secret) || !isSafeSegment(filename)) return null
  return { secret, filename }
}

function isSafeSegment(value: string | undefined): value is string {
  if (value === undefined || value.length === 0) return false
  if (value === '.' || value === '..') return false
  return !/[/\\?#\s]/.test(value)
}

/** 附件 API：`projects/<编码后的项目路径>/uploads/<secret>/<filename>`。 */
function uploadEndpoint(project: string, ref: UploadRef): string {
  return `${projectEndpoint(project)}/uploads/${encodeURIComponent(ref.secret)}/${encodeURIComponent(ref.filename)}`
}

/** 浏览器能直接打开的 GitLab 原链接（项目路由下的 uploads 路径）。 */
function uploadUrl(instanceUrl: string, project: string, ref: UploadRef): string {
  const base = instanceUrl.replace(/\/+$/, '')
  const path = project.split('/').map(encodeURIComponent).join('/')
  return `${base}/${path}/uploads/${encodeURIComponent(ref.secret)}/${encodeURIComponent(ref.filename)}`
}

/** 只认位图；SVG 等可执行内容一律按失败降级。 */
function imageMime(bytes: Uint8Array): string | null {
  if (hasSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (hasSignature(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (hasSignature(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (hasAscii(bytes, 0, 'RIFF') && hasAscii(bytes, 8, 'WEBP')) return 'image/webp'
  if (hasSignature(bytes, [0x42, 0x4d])) return 'image/bmp'
  return null
}

function hasSignature(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.byteLength < signature.length) return false
  return signature.every((value, index) => bytes[index] === value)
}

function hasAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.byteLength < offset + text.length) return false
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false
  }
  return true
}
