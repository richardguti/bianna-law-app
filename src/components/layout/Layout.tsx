import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopNav } from './TopNav'
import { BottomNav } from './BottomNav'
import { useAppStore } from '../../store/appStore'

export function Layout() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)

  return (
    <div
      className="flex overflow-hidden bg-surface"
      style={{ height: '100dvh', minHeight: '-webkit-fill-available' }}
    >
      {/* Sidebar — lg+ (1024px) only: hides on all phones and portrait iPad */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      <div className={`flex flex-col flex-1 overflow-hidden transition-all duration-300 ${sidebarOpen ? 'lg:ml-64' : ''}`}>
        <TopNav />
        <main className="flex-1 overflow-y-auto pb-16 lg:pb-0">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav — phones and portrait iPad only */}
      <BottomNav />
    </div>
  )
}
