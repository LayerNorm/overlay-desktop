import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// The renderer's single Tailwind v4 entry intentionally omits preflight.
import './styles/shared-chat.css'

const fixtureWindow = new URLSearchParams(window.location.search).get('window')
const isChatParityFixture = import.meta.env.DEV && fixtureWindow === 'chat-parity-fixture'
const isFileParityFixture = import.meta.env.DEV && fixtureWindow === 'file-parity-fixture'

// Global font-family fallback so the whole desktop UI uses the system font
// instead of falling back to Times New Roman when inline styles are missing.
const GLOBAL_FONT_CSS = `
html, body, #root {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
`
const globalStyleSheet = document.createElement('style')
globalStyleSheet.textContent = GLOBAL_FONT_CSS
document.head.appendChild(globalStyleSheet)
// Shared components use root-relative assets on the web. In Electron they must
// resolve beside the packaged renderer HTML, so the shared asset helper reads
// this host-provided base instead of embedding platform-specific imports.
document.documentElement.dataset.overlayAssetBase = '.'

const setDocumentTheme = (darkMode: boolean): void => {
  document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'
}

try {
  const settings = JSON.parse(localStorage.getItem('overlay-settings') ?? '{}') as {
    darkMode?: unknown
  }
  setDocumentTheme(settings.darkMode !== false)
} catch {
  setDocumentTheme(true)
}

window.addEventListener('overlay:settings-changed', (event) => {
  const { key, value } = (event as CustomEvent<{ key?: unknown; value?: unknown }>).detail ?? {}
  if (key === 'darkMode' && typeof value === 'boolean') {
    setDocumentTheme(value)
  }
})

window.addEventListener('overlay:app-bootstrap-updated', (event) => {
  const theme = (
    event as CustomEvent<{ uiSettings?: { theme?: 'light' | 'dark' } }>
  ).detail?.uiSettings?.theme
  if (theme) {
    setDocumentTheme(theme === 'dark')
  }
})

window.bridge?.onSettingsChanged?.(({ key, value }) => {
  if (key === 'darkMode' && typeof value === 'boolean') {
    setDocumentTheme(value)
  }
})

const root = createRoot(document.getElementById('root')!)

if (isFileParityFixture) {
  void import('./pages/FileParityFixtureWindow').then(({ FileParityFixtureWindow }) => {
    root.render(<FileParityFixtureWindow />)
  })
} else if (isChatParityFixture) {
  void Promise.all([
    import('./pages/ChatParityFixtureWindow'),
    import('./styles/chat-parity-fixture.css')
  ]).then(([{ ChatParityFixtureWindow }]) => {
    root.render(
      <StrictMode>
        <ChatParityFixtureWindow />
      </StrictMode>
    )
  })
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
