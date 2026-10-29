import type { CSSProperties } from 'react'
import { OverlayMark } from '@overlay/ui'

export function OnboardingMark({ size, color, style }: {
  size: number
  color: string
  style?: CSSProperties
}) {
  return (
    <span style={{ ...style, display: 'inline-block', color }}>
      <OverlayMark size={size} label="Overlay" />
    </span>
  )
}
