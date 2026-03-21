import type React from 'react'

export const HOST_COLOR_PALETTE = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#ec4899', // pink
]

export function hostColorStyle(color: string | undefined): React.CSSProperties {
  if (!color) return {}
  return { borderLeft: `3px solid ${color}`, paddingLeft: 9 }
}
