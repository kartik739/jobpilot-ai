'use client'

/**
 * Notification Bell UI component
 *
 * Displays a bell icon with an unread count badge in the navigation header.
 * Clicking opens a dropdown list of unread notifications.
 * Provides "Mark all as read" action and per-notification mark-as-read on click.
 *
 * Requirements: 21.3, 21.4, 21.5, 21.6
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useNotifications, type Notification } from '@/lib/useNotifications'

// ─── Bell SVG icon ────────────────────────────────────────────────────────────

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

// ─── Relative time formatter ──────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ─── Navigation helper ────────────────────────────────────────────────────────

function getNotificationHref(notification: Notification): string | null {
  const meta = notification.metadata as Record<string, unknown>
  const applicationId = meta['applicationId'] as string | undefined

  switch (notification.type) {
    case 'application_submitted':
    case 'interview_detected':
    case 'offer_received':
    case 'manual_intervention_required':
      return applicationId ? `/applications/${applicationId}` : '/applications'
    case 'source_error':
      return '/profile'
    case 'daily_limit_reached':
      return '/analytics'
    default:
      return null
  }
}

// ─── Single notification row ──────────────────────────────────────────────────

function NotificationItem({
  notification,
  onRead,
}: {
  notification: Notification
  onRead: (n: Notification) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onRead(notification)}
      className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0 focus:outline-none focus-visible:bg-blue-50"
    >
      <div className="flex items-start gap-3">
        {/* Unread dot */}
        {!notification.isRead && (
          <span className="mt-1.5 flex-shrink-0 w-2 h-2 rounded-full bg-blue-500" aria-label="Unread" />
        )}
        <div className={!notification.isRead ? '' : 'ml-5'}>
          <p className="text-sm font-medium text-gray-900 leading-tight">{notification.title}</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-snug line-clamp-2">{notification.body}</p>
          <p className="text-[10px] text-gray-400 mt-1">{formatRelativeTime(notification.createdAt)}</p>
        </div>
      </div>
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications()
  const [isOpen, setIsOpen] = useState(false)
  const [isMarkingAll, setIsMarkingAll] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const router = useRouter()

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  // Requirement 21.6: mark as read and navigate to relevant resource
  const handleNotificationClick = useCallback(
    async (notification: Notification) => {
      setIsOpen(false)
      if (!notification.isRead) {
        try {
          await markRead(notification.id)
        } catch {
          // Non-fatal — navigate anyway
        }
      }
      const href = getNotificationHref(notification)
      if (href) {
        router.push(href)
      }
    },
    [markRead, router],
  )

  // Requirement 21.5: mark all as read
  const handleMarkAllRead = useCallback(async () => {
    if (isMarkingAll || unreadCount === 0) return
    setIsMarkingAll(true)
    try {
      await markAllRead()
    } finally {
      setIsMarkingAll(false)
    }
  }, [isMarkingAll, markAllRead, unreadCount])

  // Show most recent unread notifications (cap at 20 for the dropdown)
  const unreadNotifications = notifications
    .filter((n) => !n.isRead)
    .slice(0, 20)

  return (
    <div className="relative">
      {/* Bell button — Requirement 21.3 */}
      <button
        ref={buttonRef}
        type="button"
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
            : 'Notifications'
        }
        aria-haspopup="true"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <BellIcon className="w-5 h-5" />

        {/* Unread count badge — Requirement 21.3 */}
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-blue-600 rounded-full leading-none"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown — Requirement 21.4 */}
      {isOpen && (
        <div
          ref={dropdownRef}
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-900">Notifications</h2>
            {/* Requirement 21.5: Mark all as read */}
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={isMarkingAll || unreadCount === 0}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:text-gray-400 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:underline"
            >
              {isMarkingAll ? 'Marking…' : 'Mark all as read'}
            </button>
          </div>

          {/* Notification list */}
          <div className="max-h-80 overflow-y-auto">
            {unreadNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <BellIcon className="w-8 h-8 text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">You&apos;re all caught up!</p>
                <p className="text-xs text-gray-400 mt-1">No unread notifications</p>
              </div>
            ) : (
              unreadNotifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onRead={handleNotificationClick}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
