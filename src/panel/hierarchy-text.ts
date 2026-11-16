/**
 * 父子布局的可用性与来源说明。
 *
 * 只有快照声明了父子能力时父子布局才生效；`none` 时禁用切换并说明原因。
 * 说明同时写出能力来源：GitHub 原生、GitLab 工作项或本地 `Parent:` 约定。
 */
import type { BackendKind } from '../protocol/backend.ts'
import type { TicketHierarchy } from '../protocol/tracker.ts'
import type { Translate } from './i18n.ts'

/** 父子布局的可用性与悬停说明。 */
export interface HierarchyAvailability {
  readonly available: boolean
  /** 布局按钮的悬停说明：可用时写来源，不可用时写原因。 */
  readonly hint: string
}

/**
 * 按当前后端与快照的父子能力给出布局可用性。
 * @param backend - 当前快照的后端。
 * @param hierarchy - 当前快照的父子能力。
 * @param t - 当前语言的翻译函数。
 * @returns 是否可切换，以及按钮的悬停说明。
 */
export function hierarchyAvailability(
  backend: BackendKind,
  hierarchy: TicketHierarchy,
  t: Translate,
): HierarchyAvailability {
  if (hierarchy === 'none') {
    if (backend === 'gitea') {
      return { available: false, hint: t('tickets.layout.unavailableGitea') }
    }
    if (backend === 'gitlab') {
      return { available: false, hint: t('tickets.layout.unavailableGitlab') }
    }
    return { available: false, hint: t('tickets.layout.unavailable') }
  }

  if (hierarchy === 'convention') {
    return { available: true, hint: t('tickets.layout.conventionHint') }
  }
  if (backend === 'gitlab') {
    return { available: true, hint: t('tickets.layout.gitlabHint') }
  }
  return { available: true, hint: t('tickets.layout.nativeHint') }
}
