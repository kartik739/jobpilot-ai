/**
 * useNotifications hook
 *
 * Connects to the WebSocket notification endpoint for real-time delivery.
 * Falls back to polling GET /api/notifications every 30 seconds when the
 * WebSocket is disconnected.
 * Auto-reconnects on connection loss without a page reload (exponential backoff).
 *
 * Requirements: 21.2, 21.3, 32.1, 32.3, 32.4
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import api from './api'
import { useAuthStore } from '@/store/auth'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Notification {
  id: string
  userId: string
  type: string
  title: string
  body: string
  metadata: Record<string, unknown>
  isRead: boolean
  createdAt: string
  readAt: string | null
}

interface NotificationsState {
  notifications: Notification[]
  unreadCount: number
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000
const BASE_RECONNECT_MS = 1_000
const MAX_RECONNECT_MS = 30_000
const MAX_RECONNECT_ATTEMPTS = 10

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNotifications(): NotificationsState {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const accessToken = useAuthStore((s) => s.accessToken)

  // Refs so callbacks have stable references without triggering re-renders
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const isConnectedRef = useRef(false)
  const isMountedRef = useRef(true)

  // ── Helpers ────────────────────────────────────────────────────────────────

  const addOrUpdateNotification = useCallback((incoming: Notification) => {
    setNotifications((prev) => {
      const idx = prev.findIndex((n) => n.id === incoming.id)
      if (idx !== -1) {
        const next = [...prev]
        next[idx] = incoming
        return next
      }
      return [incoming, ...prev]
    })
  }, [])

  // ── REST API helpers ───────────────────────────────────────────────────────

  const fetchUnread = useCallback(async () => {
    if (!accessToken) return
    try {
      const { data } = await api.get<{ notifications: Notification[] }>(
        '/api/notifications',
        { params: { limit: 50 } },
      )
      if (isMountedRef.current) {
        setNotifications((prev) => {
          // Merge: incoming notifications override existing ones with same id
          const map = new Map(prev.map((n) => [n.id, n]))
          for (const n of data.notifications) {
            map.set(n.id, n)
          }
          return Array.from(map.values()).sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )
        })
      }
    } catch {
      // Polling errors are non-fatal — will retry on next interval
    }
  }, [accessToken])

  const markRead = useCallback(async (id: string) => {
    const { data } = await api.patch<Notification>(`/api/notifications/${id}/read`)
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? data : n)),
    )
  }, [])

  const markAllRead = useCallback(async () => {
    await api.post('/api/notifications/mark-all-read')
    const now = new Date().toISOString()
    setNotifications((prev) =>
      prev.map((n) => (n.isRead ? n : { ...n, isRead: true, readAt: now })),
    )
  }, [])

  // ── Polling fallback ───────────────────────────────────────────────────────

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return
    // Fetch immediately when starting polling
    void fetchUnread()
    pollTimerRef.current = setInterval(() => {
      void fetchUnread()
    }, POLL_INTERVAL_MS)
  }, [fetchUnread])

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  // ── WebSocket connection ───────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (!accessToken || !isMountedRef.current) return

    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }

    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'
    const wsUrl = baseUrl.replace(/^http/, 'ws')
    const url = `${wsUrl}/api/notifications/ws?token=${encodeURIComponent(accessToken)}`

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      if (!isMountedRef.current) return
      isConnectedRef.current = true
      reconnectAttemptsRef.current = 0
      stopPolling()
    }

    ws.onmessage = (event: MessageEvent<string>) => {
      if (!isMountedRef.current) return
      try {
        const data = JSON.parse(event.data) as Notification | { type: string }
        // Skip control messages like { type: 'connected' }
        if ('id' in data && 'type' in data && 'title' in data) {
          addOrUpdateNotification(data as Notification)
        }
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onerror = () => {
      // onclose will fire after onerror — handle reconnect there
    }

    ws.onclose = () => {
      if (!isMountedRef.current) return
      isConnectedRef.current = false
      wsRef.current = null

      // Start polling while WebSocket is down
      startPolling()

      // Schedule reconnect with exponential backoff (req 32.4)
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(
          BASE_RECONNECT_MS * 2 ** reconnectAttemptsRef.current,
          MAX_RECONNECT_MS,
        )
        reconnectAttemptsRef.current += 1
        reconnectTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            connect()
          }
        }, delay)
      }
    }
  }, [accessToken, addOrUpdateNotification, startPolling, stopPolling])

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  useEffect(() => {
    isMountedRef.current = true

    if (accessToken) {
      // Initial load via REST before WebSocket connects
      void fetchUnread()
      connect()
    } else {
      // No token — just poll (will fail gracefully and await token)
      startPolling()
    }

    return () => {
      isMountedRef.current = false

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }

      stopPolling()

      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [accessToken, connect, fetchUnread, startPolling, stopPolling])

  // ── Derived state ──────────────────────────────────────────────────────────

  const unreadCount = notifications.filter((n) => !n.isRead).length

  return { notifications, unreadCount, markRead, markAllRead }
}
