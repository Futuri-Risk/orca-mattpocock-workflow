/**
 * 面板侧的能力诊断。Orca 侧真正决定面板能不能干活的是三项：
 * 面板桥（能不能把请求交给 worker）、剪贴板（能不能一键复制提示词）、
 * worker 可达（能不能完成一次请求）。
 *
 * 诊断结果的 id 与顺序固定，环境检查视图按这个顺序显示。
 */
import type { CapabilityDiagnostic } from '../protocol/env-check.ts'
import { canCopyText } from './clipboard.ts'

/** 面板侧的能力 id。 */
export const PANEL_CAPABILITY_IDS = ['panel-bridge', 'clipboard', 'worker'] as const

/** 面板侧的能力 id 的联合类型。 */
export type PanelCapabilityId = (typeof PANEL_CAPABILITY_IDS)[number]

/** 面板能自己探到的两项：面板桥与剪贴板。 */
export interface PanelCapabilityProbe {
  /** `orca.plugin.request` 是否可用。 */
  readonly bridge: boolean
  /** 剪贴板 API 未被权限策略拒绝，且至少有一条写入路径。 */
  readonly clipboard: boolean
}

/**
 * 探测面板自身的能力。
 * @returns 面板桥与剪贴板的可用性；剪贴板要读一次权限状态，因此是异步的。
 */
export async function probePanelCapabilities(): Promise<PanelCapabilityProbe> {
  const bridge =
    typeof window !== 'undefined' &&
    typeof window.orca?.plugin?.request === 'function'
  return { bridge, clipboard: await probeClipboardWritable() }
}

/**
 * 剪贴板是否真的可写：权限策略拒绝时不能声称可用。
 * 兼容写入（`execCommand`）仍会在点击时尝试，但环境检查按真实权限给建议。
 * @returns 剪贴板 API 可用或权限状态未拒绝时为 true。
 */
async function probeClipboardWritable(): Promise<boolean> {
  if (!canCopyText()) return false

  const permissions = typeof navigator === 'undefined' ? undefined : navigator.permissions
  if (typeof permissions?.query === 'function') {
    try {
      const status = await permissions.query({ name: 'clipboard-write' as PermissionName })
      if (status.state === 'denied') return false
    } catch {
      // 浏览器不认识这个权限名时按可用处理，交给复制时的降级链。
    }
  }
  return true
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
