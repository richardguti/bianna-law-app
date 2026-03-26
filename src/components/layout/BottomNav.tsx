import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

const PRIMARY_TABS = [
  { to: '/dashboard', icon: 'dashboard',      label: 'Home'     },
  { to: '/outline',   icon: 'architecture',   label: 'Outline'  },
  { to: '/tracker',   icon: 'menu_book',      label: 'Tracker'  },
  { to: '/vault',     icon: 'folder_managed', label: 'Vault'    },
] as const

const MORE_ITEMS = [
  { to: '/sessions',  icon: 'timer',          label: 'Study Sessions'  },
  { to: '/capture',   icon: 'edit_note',      label: 'Capture'         },
  { to: '/calendar',  icon: 'calendar_month', label: 'Calendar'        },
  { to: '/assistant', icon: 'smart_toy',      label: 'AI Assistant'    },
  { to: '/settings',  icon: 'settings',       label: 'Settings'        },
] as const

export function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <>
      {/* Bottom tab bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur-md border-t border-outline-variant/20 flex items-stretch pb-safe">
        {PRIMARY_TABS.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setMoreOpen(false)}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
                isActive ? 'text-primary' : 'text-on-surface-variant'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`material-symbols-outlined text-[22px] ${isActive ? 'filled' : ''}`}>
                  {icon}
                </span>
                <span className="text-[10px] font-label tracking-wide">{label}</span>
              </>
            )}
          </NavLink>
        ))}

        {/* More button */}
        <button
          onClick={() => setMoreOpen((o) => !o)}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
            moreOpen ? 'text-primary' : 'text-on-surface-variant'
          }`}
        >
          <span className="material-symbols-outlined text-[22px]">
            {moreOpen ? 'close' : 'grid_view'}
          </span>
          <span className="text-[10px] font-label tracking-wide">More</span>
        </button>
      </nav>

      {/* More sheet */}
      {moreOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-30 bg-black/20"
            onClick={() => setMoreOpen(false)}
          />
          <div className="lg:hidden fixed bottom-16 left-0 right-0 z-40 bg-surface rounded-t-2xl border-t border-outline-variant/20 shadow-2xl pb-safe">
            <div className="px-5 pt-4 pb-2">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant/60 mb-3">
                More Pages
              </p>
              <div className="grid grid-cols-3 gap-3">
                {MORE_ITEMS.map(({ to, icon, label }) => (
                  <button
                    key={to}
                    onClick={() => { navigate(to); setMoreOpen(false) }}
                    className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-surface-container-low active:bg-surface-container-high transition-colors"
                  >
                    <span className="material-symbols-outlined text-2xl text-primary">{icon}</span>
                    <span className="text-[11px] font-label text-on-surface text-center leading-tight">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
