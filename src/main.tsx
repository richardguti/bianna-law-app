import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/bia.css'
import { sanitizeBia } from './lib/sanitizeBia'
import App from './App.tsx'
import { initTheme } from './lib/theme'
import { useAppStore } from './store/appStore'

// ─── Renderer fault reporting ────────────────────────────────────────────────
// A renderer that dies during module evaluation is invisible to the main process: the
// window simply stays white while did-finish-load and ready-to-show both fire, because
// the window's backgroundColor is a paint. Forwarding the two global error events to
// boot.log means the next failure names itself instead of being inferred from a
// screenshot -- which is exactly how a missing build-time environment variable was
// misread as a rendering problem for three releases.
function reportRendererFault(kind: string, detail: string) {
  try {
    window.seniorPartner?.bootFault?.({ kind, detail: String(detail).slice(0, 2000) })
  } catch { /* diagnostics must never become a fault themselves */ }
}

window.addEventListener('error', (event) => {
  const err = event.error as Error | undefined
  reportRendererFault('error', err?.stack || event.message || 'unknown')
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as { stack?: string } | undefined
  reportRendererFault('unhandledrejection', reason?.stack || String(event.reason))
})

// Apply the stored palette before first paint (and follow the OS for 'system').
void initTheme()
// Hydrate the persisted student profile (name/school/year/photo) on boot.
void useAppStore.getState().loadProfile()

// Test hook. sanitizeBia is the one function that must never be trusted without evidence,
// and it can only be exercised where a DOM exists - so the packaged gate
// (scratch/test_chat_bia.js) drives it here. This grants no capability the page does not
// already have: the page owns the DOM it sanitises, and the function only ever returns a
// string.
//
// defineProperty with a string key, not `window.__sanitizeBia = sanitizeBia`: the plain
// assignment was dropped or renamed by the production minifier, so the hook was absent from
// the shipped bundle even though this file was current. A string key cannot be mangled, and
// defineProperty cannot be treated as dead code.
Object.defineProperty(window, '__sanitizeBia', { value: sanitizeBia, configurable: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
