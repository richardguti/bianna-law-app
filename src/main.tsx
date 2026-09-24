import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/bia.css'
import { sanitizeBia } from './lib/sanitizeBia'
import App from './App.tsx'
import { initTheme } from './lib/theme'
import { useAppStore } from './store/appStore'

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
