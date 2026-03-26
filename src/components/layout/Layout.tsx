import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopNav } from './TopNav'
import { BottomNav } from './BottomNav'
import { useAppStore } from '../../store/appStore'

export function Layout() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)

  return (
    // h-dvh = dynamic viewport height — accounts for Safari address bar on iOS
    <div className="flex h-dvh overflow-hidden bg-surface">
      {/* Sidebar — desktop only */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* md:ml-64 only applies the sidebar margin at desktop breakpoint */}
      <div className={`flex flex-col flex-1 overflow-hidden transition-all duration-300 ${sidebarOpen ? 'md:ml-64' : ''}`}>
        <TopNav />
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav — mobile only */}
      <BottomNav />
    </div>
  )
}
