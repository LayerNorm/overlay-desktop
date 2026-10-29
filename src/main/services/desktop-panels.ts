import { BrowserWindow, app, screen } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadWebShell, remotePreferences, getMainWindow } from './web-shell'
import { setVisibleOnAllWorkspacesKeepDock } from '../utils/workspace-visibility'
import { yieldFocusAfterLastPanelHidden } from '../utils/yield-focus'

type Kind = 'chat' | 'notes'
type PanelLayout = {
  x: number
  y: number
  width: number
  height: number
  edge: 'left' | 'right' | 'none'
}
const windows = new Map<Kind, BrowserWindow>()
const layouts: Partial<Record<Kind, PanelLayout>> = {}
const layoutPath = () => join(app.getPath('userData'), 'web-panel-layout.json')
export function restorePanelLayout(): void {
  try {
    if (existsSync(layoutPath()))
      Object.assign(layouts, JSON.parse(readFileSync(layoutPath(), 'utf8')))
    else {
      const oldPath = join(app.getPath('userData'), 'panel-positions.json')
      if (existsSync(oldPath)) {
        const old = JSON.parse(readFileSync(oldPath, 'utf8'))
        for (const [kind, legacy] of [
          ['chat', 'chat'],
          ['notes', 'notebook']
        ] as const) {
          layouts[kind] = {
            x: old.positions?.[legacy]?.x,
            y: old.positions?.[legacy]?.y,
            width: old.sizes?.[legacy]?.width,
            height: old.sizes?.[legacy]?.height,
            edge: 'none'
          }
        }
      }
    }
  } catch {
    /* Keep legacy files untouched. */
  }
}
function bounds(kind: Kind): PanelLayout {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const saved = layouts[kind]
  const width = Math.min(area.width, Math.max(360, saved?.width || 440))
  const height = Math.min(area.height, Math.max(300, saved?.height || 640))
  const edge = saved?.edge ?? 'none'
  return {
    width,
    height,
    edge,
    x:
      edge === 'left'
        ? area.x
        : edge === 'right'
          ? area.x + area.width - width
          : Math.max(
              area.x,
              Math.min(saved?.x ?? area.x + area.width - width - 20, area.x + area.width - width)
            ),
    y: Math.max(area.y, Math.min(saved?.y ?? area.y + 30, area.y + area.height - height))
  }
}
function get(kind: Kind): BrowserWindow {
  const existing = windows.get(kind)
  if (existing && !existing.isDestroyed()) return existing
  const window = new BrowserWindow({
    ...bounds(kind),
    title: kind === 'chat' ? 'Overlay Chat' : 'Overlay Notes',
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    alwaysOnTop: true,
    show: false,
    webPreferences: remotePreferences()
  })
  windows.set(kind, window)
  setVisibleOnAllWorkspacesKeepDock(window)
  loadWebShell(window, `/app/${kind}?surface=panel`)
  const persist = () => {
    layouts[kind] = { ...window.getBounds(), edge: layouts[kind]?.edge ?? 'none' }
    writeFileSync(layoutPath(), JSON.stringify(layouts), { mode: 0o600 })
  }
  window.on('moved', persist)
  window.on('resized', persist)
  window.on('close', (event) => {
    event.preventDefault()
    window.hide()
  })
  return window
}
export const desktopPanels = {
  show(kind: Kind): void {
    const win = get(kind)
    win.show()
    win.focus()
  },
  hide(kind: Kind): void {
    windows.get(kind)?.hide()
    if (![...windows.values()].some((win) => win.isVisible()))
      yieldFocusAfterLastPanelHidden(getMainWindow(), [])
  },
  toggle(kind: Kind): void {
    const win = get(kind)
    if (win.isVisible()) this.hide(kind)
    else this.show(kind)
  },
  setDocked(kind: Kind, edge: PanelLayout['edge']): void {
    const win = get(kind)
    layouts[kind] = { ...win.getBounds(), edge }
    win.setBounds(bounds(kind))
    writeFileSync(layoutPath(), JSON.stringify(layouts), { mode: 0o600 })
  },
  closeAll(): void {
    for (const win of windows.values()) win.destroy()
    windows.clear()
  }
}
