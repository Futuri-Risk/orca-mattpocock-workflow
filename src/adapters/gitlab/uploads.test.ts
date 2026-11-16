/**
 * 上传附件内联器的边界：只取当前项目的 `/uploads/`，其它地址不碰；
 * 失败、非图片与超限都降级成指向 GitLab 原链接的普通链接。
 */
import { describe, expect, it } from 'vitest'

import type { BinaryCommandRunner } from '../../core/ticket.ts'
import { CommandError } from '../../core/tracker-error.ts'
import { createUploadInliner } from './uploads.ts'

const ORIGIN = 'https://gitlab.example.com'
const PROJECT = 'group/sub/project'
const PROJECT_ENDPOINT = 'projects/group%2Fsub%2Fproject'
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

interface FakeBinary {
  readonly run: BinaryCommandRunner
  readonly calls: string[][]
}

function binary(options: {
  readonly bytes?: Uint8Array
  readonly fail?: boolean
}): FakeBinary {
  const calls: string[][] = []
  const run: BinaryCommandRunner = async (command, args) => {
    calls.push([command, ...args])
    if (options.fail === true) {
      throw new CommandError('failed', 'glab 退出码 1', 'glab: 404 Not Found', 1)
    }
    return { stdout: options.bytes ?? PNG, stderr: '' }
  }
  return { run, calls }
}

function makeInliner(options: {
  readonly bytes?: Uint8Array
  readonly fail?: boolean
  readonly maxBytes?: number
  readonly maxTotalBytes?: number
  readonly instanceUrl?: string
}): { readonly inline: (source: string) => Promise<string>; readonly calls: string[][] } {
  const fake = binary(options)
  const inliner = createUploadInliner({
    run: fake.run,
    workspaceRoot: '/workspace',
    instanceUrl: options.instanceUrl ?? ORIGIN,
    project: PROJECT,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    ...(options.maxTotalBytes === undefined ? {} : { maxTotalBytes: options.maxTotalBytes }),
  })
  return { inline: (source) => inliner.inline(source), calls: fake.calls }
}

describe('GitLab 上传附件内联', () => {
  it('相对路径与同项目绝对地址都内联，API 只带接口路径', async () => {
    const source = [
      '![相对](/uploads/aaa111/截图.png)',
      `![绝对](${ORIGIN}/${PROJECT}/uploads/bbb222/photo.jpg)`,
    ].join('\n')
    const { inline, calls } = makeInliner({})

    const result = await inline(source)

    expect(result).toContain('![相对](data:image/png;base64,')
    expect(result).toContain('![绝对](data:image/png;base64,')
    expect(calls).toEqual([
      ['glab', 'api', `${PROJECT_ENDPOINT}/uploads/aaa111/%E6%88%AA%E5%9B%BE.png`],
      ['glab', 'api', `${PROJECT_ENDPOINT}/uploads/bbb222/photo.jpg`],
    ])
    // token 由 glab 自己注入；这里只有接口路径。
    expect(JSON.stringify(calls)).not.toMatch(/token|glpat|PRIVATE-TOKEN/i)
  })

  it('其它项目、其它实例、普通相对地址与外链一律不碰', async () => {
    const source = [
      '![别的项目](https://gitlab.example.com/other/project/uploads/aaa111/x.png)',
      '![别的实例](https://gitlab.other.com/group/sub/project/uploads/aaa111/x.png)',
      '![绝对项目号](https://gitlab.example.com/-/project/42/uploads/aaa111/x.png)',
      '![普通相对](/assets/x.png)',
      '![外链](https://cdn.example.com/x.png)',
    ].join('\n')
    const { inline, calls } = makeInliner({})

    expect(await inline(source)).toBe(source)
    expect(calls).toEqual([])
  })

  it('带凭据或不是当前项目的绝对地址被拒绝', async () => {
    const source = [
      `![凭据](${ORIGIN.replace('https://', 'https://user:pass@')}/${PROJECT}/uploads/aaa111/x.png)`,
      '![路径穿越](/uploads/../x.png)',
      `![文件名带斜杠](${ORIGIN}/${PROJECT}/uploads/aaa111/a%2Fb.png)`,
    ].join('\n')
    const { inline, calls } = makeInliner({})

    expect(await inline(source)).toBe(source)
    expect(calls).toEqual([])
  })

  it('非图片响应降级为文件名加原链接', async () => {
    const { inline } = makeInliner({ bytes: Uint8Array.from([0x7b, 0x7d]) })

    const result = await inline('前文 ![截图](/uploads/aaa111/截图.png) 后文')

    expect(result).toBe(
      `前文 [截图](${ORIGIN}/${PROJECT}/uploads/aaa111/%E6%88%AA%E5%9B%BE.png) 后文`,
    )
  })

  it('取图失败降级为原链接，没有 alt 时用文件名', async () => {
    const { inline } = makeInliner({ fail: true })

    const result = await inline('![](/uploads/aaa111/截图.png)')

    expect(result).toBe(`[截图.png](${ORIGIN}/${PROJECT}/uploads/aaa111/%E6%88%AA%E5%9B%BE.png)`)
  })

  it('单张超过上限降级', async () => {
    const { inline } = makeInliner({ maxBytes: PNG.byteLength - 1 })

    expect(await inline('![图](/uploads/aaa111/截图.png)')).toBe(
      `[图](${ORIGIN}/${PROJECT}/uploads/aaa111/%E6%88%AA%E5%9B%BE.png)`,
    )
  })

  it('累计超过上限后其余图片降级，顺序与文档一致', async () => {
    const { inline } = makeInliner({ maxTotalBytes: PNG.byteLength + 1 })

    const result = await inline(
      '![一](/uploads/aaa111/one.png)\n![二](/uploads/bbb222/two.png)',
    )

    expect(result).toContain('![一](data:image/png;base64,')
    expect(result).toContain(`[二](${ORIGIN}/${PROJECT}/uploads/bbb222/two.png)`)
  })

  it('同一张图只取一次，正文与评论重复引用都替换', async () => {
    const { inline, calls } = makeInliner({})

    const first = await inline('![图](/uploads/aaa111/x.png)')
    const second = await inline('![图](/uploads/aaa111/x.png)')

    expect(first).toBe(second)
    expect(calls).toEqual([['glab', 'api', `${PROJECT_ENDPOINT}/uploads/aaa111/x.png`]])
  })

  it('代码围栏里的示例图片不动', async () => {
    const source = ['```markdown', '![示例](/uploads/aaa111/x.png)', '```'].join('\n')
    const { inline, calls } = makeInliner({})

    expect(await inline(source)).toBe(source)
    expect(calls).toEqual([])
  })

  it('子路径安装时按实例前缀匹配，降级链接也带前缀', async () => {
    const instanceUrl = 'https://example.com/gitlab'
    const absolute = `${instanceUrl}/${PROJECT}/uploads/aaa111/x.png`

    const ok = makeInliner({ instanceUrl })
    expect(await ok.inline(`![图](${absolute})`)).toContain('data:image/png;base64,')

    const failed = makeInliner({ instanceUrl, fail: true })
    expect(await failed.inline(`![图](${absolute})`)).toBe(
      `[图](${instanceUrl}/${PROJECT}/uploads/aaa111/x.png)`,
    )
  })

  it('文件名里的括号不影响解析', async () => {
    const { inline, calls } = makeInliner({})

    const result = await inline('![图(1)](/uploads/aaa111/图(1).png)')

    expect(result).toContain('![图(1)](data:image/png;base64,')
    expect(calls).toEqual([
      ['glab', 'api', `${PROJECT_ENDPOINT}/uploads/aaa111/%E5%9B%BE(1).png`],
    ])
  })

  it('绝对地址里的百分号编码文件名按解码后的段重新编码', async () => {
    const { inline, calls } = makeInliner({})

    const result = await inline(
      `![图](${ORIGIN}/${PROJECT}/uploads/aaa111/%E6%88%AA%E5%9B%BE.png)`,
    )

    expect(result).toContain('data:image/png;base64,')
    expect(calls).toEqual([
      ['glab', 'api', `${PROJECT_ENDPOINT}/uploads/aaa111/%E6%88%AA%E5%9B%BE.png`],
    ])
  })
})
