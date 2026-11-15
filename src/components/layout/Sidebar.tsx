import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAppStore } from '../../store/appStore'
import { loadProfileIcon } from '../../lib/courses'

/**
 * Sidebar.
 *
 * Regrouped into three sections because the app now holds two kinds of screen and they were
 * previously interleaved: the practice workspace (the twelve plugins, the reviews, the source
 * engine) and the study tools (outlines, tracker, sessions). Mixing them made the nav read as a
 * list of features rather than a description of the work, which is exactly the impression the
 * plugin index exists to correct.
 *
 * The section labels are the uppercase micro-caps used elsewhere, so the grouping is legible
 * without adding a second visual language.
 */

const SECTIONS = [
  {
    title: 'Practice',
    items: [
      { to: '/practice', icon: 'grid_view',     label: 'Practice Areas'  },
      { to: '/reviews',  icon: 'fact_check',    label: 'Reviews'         },
      { to: '/argument', icon: 'record_voice_over', label: 'Oral Argument' },
      { to: '/realworld', icon: 'newspaper',    label: 'Real World'      },
      { to: '/sources',  icon: 'account_tree',  label: 'Source Mapping'  },
      { to: '/simplify', icon: 'translate',     label: 'Simplify Legal'  },
      { to: '/florida',  icon: 'location_on',   label: 'Florida'         },
    ],
  },
  {
    title: 'Study',
    items: [
      { to: '/outline',  icon: 'architecture',   label: 'Outline Generator' },
      { to: '/exam',     icon: 'quiz',           label: 'Exam Questions'    },
      { to: '/tracker',  icon: 'menu_book',      label: 'Reading Tracker'   },
      { to: '/sessions', icon: 'timer',          label: 'Study Sessions'    },
      { to: '/whiteboard', icon: 'draw',         label: 'Whiteboard'        },
      { to: '/capture',  icon: 'edit_note',      label: 'Capture'           },
      { to: '/calendar', icon: 'calendar_month', label: 'Calendar'          },
      { to: '/vault',    icon: 'folder_managed', label: 'Document Vault'    },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/profile',   icon: 'badge',     label: 'Practice Profile' },
      { to: '/assistant', icon: 'smart_toy', label: 'AI Assistant'     },
    ],
  },
] as const

export function Sidebar() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const profile = useAppStore((s) => s.profile)
  const [profileIcon] = useState<string | null>(loadProfileIcon)
  const photo = profile.photoBase64 || profileIcon

  if (!sidebarOpen) return null

  return (
    <aside className="h-screen w-64 fixed left-0 top-0 bg-surface-container-low flex flex-col py-6 px-4 gap-2 z-40 border-r border-outline-variant">
      {/* Wordmark — a paragraph, not a heading: every page owns its own h1, and a second one in
          the chrome made the document outline start with the app name on every screen. */}
      <div className="mb-4 px-2">
        <p className="text-lg font-serif text-on-surface leading-tight">Senior Law Partner</p>
        <p className="label-micro mt-1">Practice workspace</p>
      </div>

      {/* Primary action */}
      <NavLink
        to="/reviews"
        className="flex items-center justify-between w-full px-4 py-3 mb-2 bg-primary text-on-primary text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-opacity"
      >
        <span>New review</span>
        <span className="material-symbols-outlined text-base">arrow_forward</span>
      </NavLink>

      {/* Sections */}
      <nav className="flex flex-col gap-5 flex-1 overflow-y-auto no-scrollbar">
        <NavLink
          to="/dashboard"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 text-xs font-label transition-colors ${
              isActive
                ? 'bg-surface-container-lowest text-on-surface font-semibold'
                : 'text-on-surface-variant hover:bg-surface-container-high'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span className={`material-symbols-outlined text-lg ${isActive ? 'filled' : ''}`}>
                dashboard
              </span>
              <span className="uppercase tracking-widest">Dashboard</span>
            </>
          )}
        </NavLink>

        {SECTIONS.map((section) => (
          <div key={section.title} className="flex flex-col gap-0.5">
            <p className="label-micro px-3 pb-1.5">{section.title}</p>
            {section.items.map(({ to, icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 text-xs font-label transition-colors ${
                    isActive
                      ? 'bg-surface-container-lowest text-on-surface font-semibold'
                      : 'text-on-surface-variant hover:bg-surface-container-high'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`material-symbols-outlined text-lg ${isActive ? 'filled' : ''}`}
                    >
                      {icon}
                    </span>
                    <span className="uppercase tracking-widest">{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="pt-4 border-t border-outline-variant space-y-1">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 text-xs font-label transition-colors ${
              isActive
                ? 'bg-surface-container-lowest text-on-surface font-semibold'
                : 'text-on-surface-variant hover:bg-surface-container-high'
            }`
          }
        >
          <span className="material-symbols-outlined text-lg">settings</span>
          <span className="uppercase tracking-widest">Settings</span>
        </NavLink>

        <div className="flex items-center gap-3 px-3 py-2 text-xs text-on-surface-variant">
          <div className="w-7 h-7 rounded-full overflow-hidden bg-surface-container flex items-center justify-center shrink-0">
            {photo ? (
              <img src={photo} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <span className="material-symbols-outlined text-base">person</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-on-surface text-xs truncate">
              {profile.name || 'Bianna'}
            </p>
            <p className="label-micro truncate mt-0.5">
              {[profile.school, profile.year].filter(Boolean).join(' · ') || 'St. Thomas · 1L'}
            </p>
          </div>
        </div>
      </div>
    </aside>
  )
}
