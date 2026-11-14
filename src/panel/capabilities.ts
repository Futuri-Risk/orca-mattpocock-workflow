/**
 * 面板侧的能力诊断。Orca 侧真正决定面板能不能干活的是三项：
 * 面板桥（能不能把请求交给 worker）、剪贴板（能不能一键复制提示词）、
 * worker 可达（能不能完成一次请求）。
 *
 * 诊断结果的 id 与顺序固定，环境检查视图按这个顺序显示。
 */
import type { CapabilityDiagnostic } from '../protocol/env-check.ts'

/** 面板侧的能力 id。 */
export const PANEL_CAPABILITY_IDS = ['panel-bridge', 'clipboard', 'worker'] as const

/** 面板侧的能力 id 的联合类型。 */
export type PanelCapabilityId = (typeof PANEL_CAPABILITY_IDS)[number]

/** 面板能自己探到的两项：面板桥与剪贴板。 */
export interface PanelCapabilityProbe {
  /** `orca.plugin.request` 是否可用。 */
  readonly bridge: boolean
  /** `navigator.clipboard.writeText` 是否可用。 */
  readonly clipboard: boolean
}

/**
 * 探测面板自身的能力。
 * @returns 面板桥与剪贴板的可用性。
 */
export function probePanelCapabilities(): PanelCapabilityProbe {
  const bridge =
    typeof window !== 'undefined' &&
    typeof window.orca?.plugin?.request === 'function'
  const clipboard =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'
  return { bridge, clipboard }
}

/**
 * 汇总面板侧的能力诊断。
 * @param probe - 面板桥与剪贴板的探测结果。
 * @param workerReachable - 是否成功完成过一次 worker 请求。
 * @returns 固定顺序的能力诊断列表。
 */
export function panelCapabilityDiagnostics(
  probe: PanelCapabilityProbe,
  workerReachable: boolean,
): readonly CapabilityDiagnostic[] {
  const present: Record<PanelCapabilityId, boolean> = {
    'panel-bridge': probe.bridge,
    clipboard: probe.clipboard,
    worker: workerReachable,
  }
  return PANEL_CAPABILITY_IDS.map((id) => ({
    id,
    category: 'host-service' as const,
    status: present[id] ? ('present' as const) : ('missing' as const),
  }))
}
