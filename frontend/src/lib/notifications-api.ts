/**
 * Notifications API helpers
 *
 * Used by NotificationBell for polling fallback via TanStack Query.
 * Requirements: 21.3, 21.4, 21.5, 21.6
 */

import api from './api'
import type { Notification } from './useNotifications'

export interface NotificationsResponse {
  notifications: Notification[]
}

/** Fetch unread notifications (GET /api/notifications) */
export async function getNotifications(limit = 50): Promise<NotificationsResponse> {
  const { data } = await api.get<NotificationsResponse>('/api/notifications', {
    params: { limit },
  })
  return data
}

/**
 * Mark a single notification as read.
 * Requirement 21.6
 */
export async function markNotificationRead(id: string): Promise<Notification> {
  const { data } = await api.patch<Notification>(`/api/notifications/${id}/read`)
  return data
}

/**
 * Mark all unread notifications as read.
 * Requirement 21.5
 */
export async function markAllNotificationsRead(): Promise<{ updatedCount: number }> {
  const { data } = await api.post<{ updatedCount: number }>('/api/notifications/mark-all-read')
  return data
}
