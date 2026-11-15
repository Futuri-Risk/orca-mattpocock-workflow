/**
 * 详情视图里的标签着色：按仓库颜色做浅底、描边和文字。
 *
 * 颜色都和宿主的文字色混合，深浅两种主题下都可读。
 */
import type { CSSProperties } from 'react'

import { COLORS } from './task-panel-styles.ts'

/**
 * 标签小块的着色：仓库颜色做 18% 浅底、50% 描边，文字按颜色亮度和宿主文字色混合；
 * 没有颜色（尚未读到候选、或后端不给颜色）时退回中性描边。
 * @param color - `#rrggbb` 颜色或 null。
 * @returns 叠加到小块基础样式上的颜色属性。
 */
export function labelColorStyle(color: string | null): CSSProperties {
  if (color === null) return {}
  // 浅色标签（如 #a2eeef）直接混一半会和白底贴在一起：越亮的颜色，文字越偏向宿主文字色。
  const share = textShare(color)
  return {
    background: `color-mix(in srgb, ${color} 18%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 50%, transparent)`,
    color: `color-mix(in srgb, ${color} ${String(share)}%, ${COLORS.text})`,
  }
}

/** 标签颜色在文字色里的占比：按相对亮度分三档。 */
function textShare(color: string): number {
  const luminance = relativeLuminance(color)
  if (luminance === null) return 55
  if (luminance > 0.6) return 25
  if (luminance > 0.3) return 45
  return 65
}

/** `#rrggbb` 的相对亮度（WCAG 定义）；格式不对时为 null。 */
function relativeLuminance(color: string): number | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (match === null) return null
  const [r, g, b] = [match[1], match[2], match[3]].map((hex) => {
    const channel = Number.parseInt(hex ?? '0', 16) / 255
    return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}
