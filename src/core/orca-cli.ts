/**
 * Orca 命令行的解析规则：候选顺序与版本输出校验。只做纯计算，不启动进程。
 *
 * 顺序沿用 Orca 自己的编排命令：
 * `ORCA_CLI_COMMAND` → 开发版（`ORCA_DEV_REPO_ROOT` 存在时用 `orca-dev`）→
 * 平台默认命令（macOS `orca`、Linux `orca-ide`）→ Homebrew 常见安装路径。
 * Linux 上裸 `orca` 可能是同名读屏软件，所以默认用 `orca-ide`。
 */

/** 版本查询的时长上限：只是确认可执行文件身份，不该拖住面板。 */
export const ORCA_VERSION_TIMEOUT_MS = 5_000

/** 解析候选所需的环境变量；只读这几个，便于测试注入。 */
export interface OrcaCliEnvironment {
  readonly ORCA_CLI_COMMAND?: string | undefined
  readonly ORCA_DEV_REPO_ROOT?: string | undefined
}

/**
 * 按解析顺序列出候选命令。
 * @param env - 进程环境变量里的相关项。
 * @param platform - `process.platform`。
 * @returns 去重后的候选；显式配置项永远排在最前。
 */
export function orcaCliCandidates(
  env: OrcaCliEnvironment,
  platform: NodeJS.Platform,
): readonly string[] {
  const candidates: string[] = []
  const configured = env.ORCA_CLI_COMMAND?.trim()
  if (configured !== undefined && configured.length > 0) candidates.push(configured)

  const devRepo = env.ORCA_DEV_REPO_ROOT?.trim()
  if (devRepo !== undefined && devRepo.length > 0) {
    candidates.push('orca-dev')
  }

  const names = platform === 'linux' ? ['orca-ide', 'orca'] : ['orca']
  candidates.push(...names)

  const fallbacks =
    platform === 'linux'
      ? ['/opt/homebrew/bin/orca-ide', '/usr/local/bin/orca-ide']
      : ['/opt/homebrew/bin/orca', '/usr/local/bin/orca']
  candidates.push(...fallbacks)

  return [...new Set(candidates)]
}

/**
 * 从 `orca --version` 的输出里读出版本号。
 *
 * 只认带语义版本的输出：Linux 上 PATH 里的同名 `orca` 是读屏软件，退出码可能为 0，
 * 不能只看命令是否存在。`orca-dev` 的输出也带版本号。
 * @param stdout - 命令的标准输出。
 * @returns 版本号；输出不像 Orca CLI 时是 undefined。
 */
export function parseOrcaVersion(stdout: string): string | undefined {
  const line = stdout
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0)
  if (line === undefined) return undefined
  return /\d+\.\d+\.\d+/.test(line) ? line : undefined
}
