import { create } from 'zustand'
import type { DocumentSubject } from '../types/database'

interface AppState {
  /* Sidebar */
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void

  /* Active course context (shared across pages) */
  activeSubject: DocumentSubject
  setActiveSubject: (subject: DocumentSubject) => void

  /* Anthropic API key (stored locally, never sent to Supabase) */
  apiKey: string
  setApiKey: (key: string) => void

  /* Global loading / error toast state */
  globalError: string | null
  setGlobalError: (msg: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen:    true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar:  () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  activeSubject:    'contracts',
  setActiveSubject: (subject) => set({ activeSubject: subject }),

  apiKey:    localStorage.getItem('slp_api_key') ?? '',
  setApiKey: (key) => {
    localStorage.setItem('slp_api_key', key)
    set({ apiKey: key })
  },

  globalError:    null,
  setGlobalError: (msg) => set({ globalError: msg }),
}))
