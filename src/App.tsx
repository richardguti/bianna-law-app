import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { migrateLegacyCustomSubjects } from './lib/editableFields'
import { useAppStore } from './store/appStore'

import { Layout }          from './components/layout/Layout'
import { Dashboard }       from './pages/Dashboard'
import { OutlineGenerator }from './pages/OutlineGenerator'
import { ReadingTracker }  from './pages/ReadingTracker'
import { StudySessions }   from './pages/StudySessions'
import { DocumentVault }   from './pages/DocumentVault'
import { Capture }         from './pages/Capture'
import { Calendar }        from './pages/Calendar'
import { Settings }        from './pages/Settings'
import { Assistant }       from './pages/Assistant'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
  },
})

/**
 * Reports a genuine React mount to the main process.
 *
 * This exists because `ready-to-show` cannot answer the question it was being asked to
 * answer. Electron fires that event as soon as the window has anything to display, and
 * `backgroundColor: '#F8F9FA'` is something -- so it fired on builds whose renderer
 * bundle threw at module scope, before React ever ran. Three releases were signed off on
 * the strength of that event while the window was in fact blank.
 *
 * An effect can only run after a real commit, and this component sits inside the whole
 * provider tree, so the ping reaches boot.log only if the bundle evaluated, App rendered
 * and every provider mounted. It is the one signal that means what it says.
 */
function BootSignal() {
  useEffect(() => {
    window.seniorPartner?.rendererMounted?.()
  }, [])
  return null
}

export default function App() {
  // One-shot: move pre-1.2.0 custom preset values out of localStorage and into the
  // app's store. Best-effort by design - boot must never depend on the migration, and
  // the legacy key is only cleared once the main process confirms the write.
  useEffect(() => { void migrateLegacyCustomSubjects() }, [])

  // One-shot: hand the default API key to the main process.
  //
  // The key is inlined into this renderer bundle at build time (from the gitignored
  // .env.local, or the DEEPSEEK_KEY repository secret on CI), so the main process has
  // no copy of it. Without this hand-off `ipcMain.handle('api-key-exists')` -- which
  // is `!!getDeepSeekKey()` -- reports false, and the UI tells the student her key is
  // missing while every call already carries one.
  //
  // Best-effort by design: boot never depends on it, and a key she has saved herself
  // always wins, because we only write when the main process has none.
  useEffect(() => {
    const key = useAppStore.getState().apiKey?.trim()
    const bridge = window.seniorPartner
    if (!key || !bridge) return
    void bridge
      .apiKeyExists()
      .then((exists) => (exists ? undefined : bridge.apiKeySave(key)))
      .catch(() => { /* non-fatal: requests carry the key explicitly regardless */ })
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <BootSignal />
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/outline"   element={<OutlineGenerator />} />
            <Route path="/tracker"   element={<ReadingTracker />} />
            <Route path="/sessions"  element={<StudySessions />} />
            <Route path="/vault"     element={<DocumentVault />} />
            <Route path="/capture"   element={<Capture />} />
            <Route path="/calendar"  element={<Calendar />} />
            <Route path="/settings"   element={<Settings />} />
            <Route path="/assistant"  element={<Assistant />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  )
}
