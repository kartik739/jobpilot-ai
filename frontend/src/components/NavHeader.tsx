import dynamic from 'next/dynamic'
import Link from 'next/link'

// Lazy-load the completeness badge (it's client-only — uses TanStack Query)
const ProfileCompletenessBadge = dynamic(
  () => import('./ProfileCompletenessBadge'),
  {
    ssr: false,
    loading: () => (
      <div className="w-24 h-8 rounded-full bg-gray-100 animate-pulse" />
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

        {/* Right section */}
        <div className="flex items-center gap-4">
          <ProfileCompletenessBadge />
        </div>
      </div>
    </nav>
  )
}
