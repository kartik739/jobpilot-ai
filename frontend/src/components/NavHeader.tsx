import dynamic from 'next/dynamic'
import Link from 'next/link'

// Lazy-load client-only components (use TanStack Query / WebSocket)
const ProfileCompletenessBadge = dynamic(
  () => import('./ProfileCompletenessBadge'),
  {
    ssr: false,
    loading: () => (
      <div className="w-24 h-8 rounded-full bg-gray-100 animate-pulse" />
    ),
  }
)

// Requirement 21.3: notification bell with unread count badge
const NotificationBell = dynamic(
  () => import('./NotificationBell'),
  {
    ssr: false,
    loading: () => (
      <div className="w-9 h-9 rounded-full bg-gray-100 animate-pulse" />
    ),
  }
)

export default function NavHeader() {
  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        {/* Logo / brand */}
        <Link href="/" className="flex items-center gap-2 font-bold text-gray-900 hover:text-blue-600 transition-colors">
          <span className="text-xl">✈</span>
          <span>JobPilot AI</span>
        </Link>

        {/* Primary nav links */}
        <div className="hidden sm:flex items-center gap-1 text-sm font-medium text-gray-600">
          <Link href="/jobs" className="px-3 py-1.5 rounded-lg hover:bg-gray-100 hover:text-gray-900 transition-colors">
            Jobs
          </Link>
          <Link href="/applications" className="px-3 py-1.5 rounded-lg hover:bg-gray-100 hover:text-gray-900 transition-colors">
            Applications
          </Link>
          <Link href="/analytics" className="px-3 py-1.5 rounded-lg hover:bg-gray-100 hover:text-gray-900 transition-colors">
            Analytics
          </Link>
          <Link href="/sources" className="px-3 py-1.5 rounded-lg hover:bg-gray-100 hover:text-gray-900 transition-colors">
            Sources
          </Link>
        </div>

        {/* Right section */}
        <div className="flex items-center gap-3">
          {/* Requirement 21.3, 21.4, 21.5, 21.6 */}
          <NotificationBell />
          <ProfileCompletenessBadge />
        </div>
      </div>
    </nav>
  )
}
