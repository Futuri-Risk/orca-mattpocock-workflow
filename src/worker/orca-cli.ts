/**
 * Orca 命令行的解析与版本确认。
 *
 * 候选顺序来自 core 的纯函数；这里只负责逐个跑 `--version` 并确认它真的是 Orca CLI。
 * 找不到时返回 undefined，由调用方翻译成「命令行缺失」或环境检查失败项。
 */
import {
  ORCA_VERSION_TIMEOUT_MS,
  orcaCliCandidates,
  parseOrcaVersion,
} from '../core/orca-cli.ts'
import type { CommandRunner } from '../core/ticket.ts'

/** 解析成功的 Orca 命令行。 */
export interface OrcaCli {
  /** 用于启动命令的候选名或路径。 */
  readonly command: string
  /** 命令执行器解析出的绝对路径；假执行器可能省略。 */
  readonly executable?: string
  /** `--version` 输出里的版本行。 */
  readonly version: string
}

/** 解析选项。 */
export interface ResolveOrcaCliOptions {
  /** 候选命令；缺省按环境变量与平台推导。 */
  readonly candidates?: readonly string[] | undefined
  /** 版本查询的工作目录；不影响解析。 */
  readonly cwd?: string | undefined
}

/**
 * 找一台机器上可用的 Orca 命令行。
 *
 * 对每个候选先跑一次 `--version`，输出里必须带语义版本；Linux 上同名读屏软件
 * 会在这里被排除。全部失败时返回 undefined。
 * @param run - 命令执行器。
 * @param options - 候选与工作目录。
 * @returns 可用的命令行；没有时是 undefined。
 */
export async function resolveOrcaCli(
  run: CommandRunner,
  options: ResolveOrcaCliOptions = {},
): Promise<OrcaCli | undefined> {
  const candidates =
    options.candidates ?? orcaCliCandidates(process.env, process.platform)

  for (const command of candidates) {
    try {
      const output = await run(command, ['--version'], {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        timeoutMs: ORCA_VERSION_TIMEOUT_MS,
      })
      const version = parseOrcaVersion(output.stdout)
      if (version === undefined) continue
      return {
        command,
        ...(output.executable === undefined ? {} : { executable: output.executable }),
        version,
      }
    } catch {
      // 不是这个候选：继续下一个。显式配置错误的命令也继续，避免把可用安装挡在后面。
    }
  }

  return undefined
}
