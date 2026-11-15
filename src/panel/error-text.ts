/**
 * 错误码到用户可操作提示的映射。列表视图与详情视图共用同一套文案，
 * 同一个后端故障在两个入口不会给出两种说法。
 *
 * 未覆盖的错误码回落到后端给的原始诊断；翻译只发生在有固定文案的码上。
 */
import type { MessageId } from '../protocol/i18n.ts'
import { ENV_ISSUE_ERROR_CODES, type ErrorCode, type RpcErrorBody } from '../protocol/tracker.ts'
import type { Translate } from './i18n.ts'

const ERROR_MESSAGES: Partial<Record<ErrorCode, MessageId>> = {
  'gh-missing': 'error.gh-missing',
  'gh-unauthenticated': 'error.gh-unauthenticated',
  'glab-missing': 'error.glab-missing',
  'glab-unauthenticated': 'error.glab-unauthenticated',
  'tea-missing': 'error.tea-missing',
  'tea-unauthenticated': 'error.tea-unauthenticated',
  'markdown-read-failed': 'error.markdown-read-failed',
  'ticket-not-found': 'error.ticket-not-found',
  'orca-missing': 'error.orca-missing',
}

/**
 * 把 RPC 错误翻译成一句可操作的提示。
 * @param error - 宿主返回的错误体。
 * @param t - 当前语言的翻译函数。
 * @returns 固定文案；没有固定文案时用后端给的诊断。
 */
export function errorText(error: RpcErrorBody, t: Translate): string {
  const id = ERROR_MESSAGES[error.code]
  return id === undefined ? error.message : t(id)
}

/**
 * 是否属于环境问题；列表视图据此给出「查看环境检查」入口。
 * @param code - 错误码。
 * @returns 环境类错误码时为 true。
 */
export function isEnvIssue(code: ErrorCode): boolean {
  return ENV_ISSUE_ERROR_CODES.includes(code)
}
