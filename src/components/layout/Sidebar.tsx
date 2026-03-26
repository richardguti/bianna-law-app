import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAppStore } from '../../store/appStore'
import { loadProfileIcon } from '../../lib/courses'

const NAV_ITEMS = [
  { to: '/dashboard',       icon: 'dashboard',       label: 'Dashboard'         },
  { to: '/outline',         icon: 'architecture',    label: 'Outline Generator' },
  { to: '/tracker',         icon: 'menu_book',       label: 'Reading Tracker'   },
  { to: '/sessions',        icon: 'timer',           label: 'Study Sessions'    },
  { to: '/vault',           icon: 'folder_managed',  label: 'Document Vault'    },
  { to: '/capture',         icon: 'edit_note',       label: 'Capture'           },
  { to: '/calendar',        icon: 'calendar_month',  label: 'Calendar'          },
  { to: '/assistant',       icon: 'smart_toy',       label: 'AI Assistant'      },
] as const

export function Sidebar() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const [profileIcon] = useState<string | null>(loadProfileIcon)

  if (!sidebarOpen) return null

  return (
    <aside className="h-screen w-64 fixed left-0 top-0 bg-surface-container-low flex flex-col py-6 px-4 gap-2 z-40 border-r border-outline-variant/20">
      {/* Logo */}
      <div className="mb-4 px-2">
        <h1 className="text-lg font-serif text-primary leading-tight">Senior Law Partner</h1>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant/70 mt-0.5">
          Partner Workspace
        </p>
      </div>

      {/* New Case File CTA */}
      <NavLink
        to="/outline"
        className="flex items-center gap-2 w-full px-4 py-3 mb-2 bg-primary text-on-primary rounded-full shadow-sm hover:opacity-90 transition-opacity active:scale-95 text-sm font-semibold"
      >
        <span className="material-symbols-outlined text-[18px]">add</span>
        New Case File
      </NavLink>

      {/* Nav links */}
      <nav className="flex flex-col gap-1 flex-1 overflow-y-auto no-scrollbar">
        {NAV_ITEMS.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-label transition-all duration-200 ${
                isActive
                  ? 'bg-surface-container-lowest text-primary shadow-sm font-semibold scale-[0.98]'
                  : 'text-stone-600 hover:bg-surface-container-high hover:translate-x-0.5'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`material-symbols-outlined text-xl ${isActive ? 'filled' : ''}`}
                >
                  {icon}
                </span>
                <span className="uppercase tracking-widest">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Gmail quick-launch */}
      <button
        onClick={() => (window as any).seniorPartner?.openExternalUrl?.('https://mail.google.com')}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-label w-full
          text-stone-600 hover:bg-surface-container-high hover:translate-x-0.5 transition-all duration-200"
      >
        <span className="material-symbols-outlined text-xl text-[#EA4335]">mail</span>
        <span className="uppercase tracking-widest">Gmail</span>
      </button>

      {/* Bottom — settings + user */}
      <div className="pt-4 border-t border-outline-variant/10 space-y-1">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-label transition-all duration-200 ${
              isActive ? 'bg-surface-container-lowest text-primary shadow-sm font-semibold' : 'text-stone-600 hover:bg-surface-container-high'
            }`
          }
        >
          <span className="material-symbols-outlined text-xl">settings</span>
          <span className="uppercase tracking-widest">Settings</span>
        </NavLink>

        <div className="flex items-center gap-3 px-3 py-2 text-xs text-on-surface-variant">
          <div className="w-7 h-7 rounded-full overflow-hidden bg-surface-container flex items-center justify-center shrink-0">
            {profileIcon
              ? <img src={profileIcon} alt="Profile" className="w-full h-full object-cover" />
              : <span className="material-symbols-outlined text-base">person</span>
            }
          </div>
          <div>
            <p className="font-semibold text-on-surface text-xs">Bianna</p>
            <p className="text-[10px] tracking-wide opacity-60">St. Thomas · 1L</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
