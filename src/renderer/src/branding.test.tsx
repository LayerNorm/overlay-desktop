import React from 'react'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'
import { BrandLockup } from '../../../packages/overlay-ui/src/components/orb/BrandLockup'
import { MarkdownMessage } from '../../../packages/overlay-chat-react/src/components/MarkdownMessage'
import { ToolLineLogo } from '../../../packages/overlay-chat-react/src/components/exchange/tool-rail'
import { ToolCallRowWithReasoning } from '../../../packages/overlay-chat-react/src/components/exchange/tool-call-rows'
import { OnboardingMark } from './components/onboarding/OnboardingMark'

describe('desktop O branding', () => {
  it.each(['#ededf0', '#18181b'])('keeps onboarding artwork readable with foreground %s', (color) => {
    const markup = renderToStaticMarkup(<OnboardingMark size={50} color={color} />)
    expect(markup).toContain(`color:${color}`)
    expect(markup).toContain('fill="currentColor"')
    expect(markup).not.toContain('<img')
  })

  it('keeps failed tool rows logo-free', () => {
    const markup = renderToStaticMarkup(<ToolCallRowWithReasoning block={{
      kind: 'tool', key: 'failed', name: 'search', state: 'output-error',
    }} />)
    expect(markup).not.toContain('overlay-mark')
  })

  it('renders the accessible, theme-colored mark and capitalized lockup', () => {
    const mark = renderToStaticMarkup(<OverlayMark />)
    expect(mark).toContain('fill="currentColor"')
    expect(mark).toContain('viewBox="43 -815 860 860"')
    expect(mark.match(/<path /g)).toHaveLength(2)
    const lockup = renderToStaticMarkup(<BrandLockup />)
    expect(lockup).toContain('aria-label="Overlay"')
    expect(lockup).toContain('verlay')
  })

  it('keeps the tool logo compatibility slot empty while running or idle', () => {
    expect(renderToStaticMarkup(<ToolLineLogo running />)).toBe('')
    expect(renderToStaticMarkup(<ToolLineLogo />)).toBe('')
  })

  it.each(['token', 'chunk'] as const)('uses inline looking eyes for empty %s streams', (streamingMode) => {
    const markup = renderToStaticMarkup(<MarkdownMessage text="" isStreaming streamingMode={streamingMode} />)
    expect(markup).toContain('overlay-mark--look')
    expect(markup).toContain('<svg')
    expect(markup).not.toContain('<img')
  })

  it('leaves an empty completed response empty', () => {
    expect(renderToStaticMarkup(<MarkdownMessage text="" isStreaming={false} />)).toBe('')
  })

  it('preserves raster canvas sizes and native ICNS representations', () => {
    for (const [path, width, height] of [
      ['resources/icon.png', 1024, 1024],
      ['resources/icon-tray.png', 22, 22],
      ['resources/logos/logo-big.png', 1024, 1024],
      ['resources/logos/logo-big-no-bg.png', 1024, 1024],
      ['resources/logos/logo-big-no-bg-menu-tray-icon.png', 16, 16],
      ['resources/logos/overlay-chat-mark.png', 368, 366],
    ] as const) {
      const png = readFileSync(path)
      expect(png.subarray(1, 4).toString()).toBe('PNG')
      expect(png.readUInt32BE(16)).toBe(width)
      expect(png.readUInt32BE(20)).toBe(height)
    }
    const icns = readFileSync('resources/icon.icns')
    expect(icns.subarray(0, 4).toString()).toBe('icns')
    expect(icns.readUInt32BE(4)).toBe(icns.length)
    for (const tag of ['icp4', 'ic11', 'ic12', 'ic07', 'ic08', 'ic09', 'ic10']) {
      expect(icns.includes(Buffer.from(tag))).toBe(true)
    }
  })
})
