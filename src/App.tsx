import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { Layout }          from './components/layout/Layout'
import { Dashboard }       from './pages/Dashboard'
import { OutlineGenerator }from './pages/OutlineGenerator'
import { ReadingTracker }  from './pages/ReadingTracker'
import { StudySessions }   from './pages/StudySessions'
import { DocumentVault }   from './pages/DocumentVault'
import { Capture }         from './pages/Capture'
import { Calendar }        from './pages/Calendar'
import { Settings }        from './pages/Settings'
import { OpenClawAssistant } from './pages/OpenClawAssistant'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
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
            <Route path="/assistant"  element={<OpenClawAssistant />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  )
}
