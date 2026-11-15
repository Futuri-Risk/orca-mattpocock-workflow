/**
 * 后端在界面上的短名与全名。品牌名保持原样，只有本地 Markdown 需要翻译。
 * 列表徽标、概览、详情与环境检查共用这一份推导。
 */
import { BACKEND_LABELS, type BackendKind } from '../protocol/backend.ts'
import type { Translate } from './i18n.ts'

/**
 * 列表与标题里的短名：GitHub / GitLab / Gitea 原样，本地 Markdown 走目录。
 * @param backend - 后端类型。
 * @param t - 当前语言的翻译函数。
 * @returns 显示名。
 */
export function backendLabel(backend: BackendKind, t: Translate): string {
  return backend === 'markdown' ? t('backend.markdown') : BACKEND_LABELS[backend]
}

/**
 * 环境检查顶部的后端标记；本地后端写全名，避免与「没有后端」混淆。
 * @param backend - 后端类型；未判定时为 null。
 * @param t - 当前语言的翻译函数。
 * @returns 显示名。
 */
export function backendFullLabel(backend: BackendKind | null, t: Translate): string {
  if (backend === null) return t('backend.unknown')
  return backend === 'markdown' ? t('backend.markdownFull') : BACKEND_LABELS[backend]
}
