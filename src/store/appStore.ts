import { create } from 'zustand'
import type { DocumentSubject } from '../types/database'

// Single source of truth: the injected default lives in lib/deepseek.ts. Imported
// rather than duplicated so there is exactly one place a credential could appear,
// and re-exported because callers already read it from the store module.
import { DEFAULT_DEEPSEEK_KEY } from '../lib/deepseek'
export { DEFAULT_DEEPSEEK_KEY }

interface AppState {
  /* Sidebar */
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void

  /* Active course context (shared across pages) */
  activeSubject: DocumentSubject
  setActiveSubject: (subject: DocumentSubject) => void

  /* Free-text subject used when the Outline Generator's "Other" is chosen */
  customSubject: string
  setCustomSubject: (value: string) => void

  /* DeepSeek API key (stored locally, preconfigured with Bianna's key) */
  apiKey: string
  setApiKey: (key: string) => void

  /* Global loading / error toast state */
  globalError: string | null
  setGlobalError: (msg: string | null) => void

  /* Student profile (persisted via electron-store, loaded on boot) */
  profile: UserProfile
  setProfile: (profile: UserProfile) => void
  loadProfile: () => Promise<void>
}

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen:    true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar:  () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  activeSubject:    'contracts',
  setActiveSubject: (subject) => set({ activeSubject: subject }),

  customSubject:    localStorage.getItem('slp_custom_subject') || '',
  setCustomSubject: (value) => {
    localStorage.setItem('slp_custom_subject', value)
    set({ customSubject: value })
  },

  apiKey:    localStorage.getItem('slp_api_key') || DEFAULT_DEEPSEEK_KEY,
  setApiKey: (key) => {
    localStorage.setItem('slp_api_key', key)
    set({ apiKey: key })
  },

  globalError:    null,
  setGlobalError: (msg) => set({ globalError: msg }),

  profile:    { name: 'Bianna', school: 'St. Thomas', year: '1L', email: '', photoBase64: null },
  setProfile: (profile) => set({ profile }),
  loadProfile: async () => {
    try {
      const res = await window.seniorPartner?.profileGet?.()
      if (res?.success && res.profile) set({ profile: { ...res.profile } })
    } catch { /* no bridge (web dev) — keep defaults */ }
  },
}))
