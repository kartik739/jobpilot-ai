/**
 * Notification routes
 *
 * GET  /api/notifications              — list unread notifications (polling fallback)
 * PATCH /api/notifications/:id/read   — mark single notification as read
 * POST /api/notifications/mark-all-read — mark all notifications as read (atomic)
 * GET  /api/notifications/ws           — WebSocket endpoint for real-time delivery
 *
 * Requirements: 21.2, 21.3, 32.1, 32.3, 32.4
 */

import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { Redis as RedisClient } from 'ioredis';
import { authenticate } from '../../core/auth.js';
import { prisma } from '../../db.js';
import { notificationChannel } from '../../services/notificationManager.js';
import { createChildLogger } from '../../core/logger.js';

const log = createChildLogger({ module: 'notificationRoutes' });

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function notificationRoutes(
  app: FastifyInstance,
  options: { redis: Redis },
): Promise<void> {
  const { redis } = options;

  // ── GET /api/notifications ────────────────────────────────────────────────
  // Returns unread notifications for the authenticated user.
  // Used as the 30-second polling fallback when WebSocket is unavailable.
  // Requirements: 21.3, 32.3
  app.get(
    '/api/notifications',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;
      const query = request.query as { limit?: string };
      const rawLimit = parseInt(query.limit ?? String(DEFAULT_LIMIT), 10);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, MAX_LIMIT)
        : DEFAULT_LIMIT;

      const notifications = await prisma.notification.findMany({
        where: { userId, isRead: false },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return reply.status(200).send({ notifications });
    },
  );

  // ── PATCH /api/notifications/:id/read ────────────────────────────────────
  // Marks a single notification as read.
  app.patch(
    '/api/notifications/:id/read',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;
      const { id } = request.params as { id: string };

      const existing = await prisma.notification.findFirst({
        where: { id, userId },
        select: { id: true },
      });

      if (!existing) {
        return reply.status(404).send({ error: 'Notification not found' });
      }

      const updated = await prisma.notification.update({
        where: { id },
        data: { isRead: true, readAt: new Date() },
      });

      return reply.status(200).send(updated);
    },
  );

  // ── POST /api/notifications/mark-all-read ────────────────────────────────
  // Marks all unread notifications as read for the authenticated user.
  // Uses an atomic Prisma transaction.
  app.post(
    '/api/notifications/mark-all-read',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;
      const now = new Date();

      const result = await prisma.$transaction(async (tx) => {
        const { count } = await tx.notification.updateMany({
          where: { userId, isRead: false },
          data: { isRead: true, readAt: now },
        });
        return { updatedCount: count };
      });

      return reply.status(200).send(result);
    },
  );

  // ── GET /api/notifications/ws ─────────────────────────────────────────────
  // WebSocket endpoint. Authenticate via JWT in `?token=` query param.
  // Subscribes to the user's Redis notification channel and forwards messages
  // to the connected WebSocket client.
  // Requirements: 21.2, 32.1, 32.4
  app.get(
    '/api/notifications/ws',
    { websocket: true },
    async (socket, request) => {
      // ── JWT authentication via query param ──────────────────────────────
      const query = request.query as { token?: string };
      const token = query.token;

      if (!token) {
        log.warn('WebSocket connection rejected: missing token');
        socket.close(4001, 'Missing authentication token');
        return;
      }

      let userId: string;
      try {
        const payload = await app.jwt.verify<{ id: string; email: string }>(token);
        userId = payload.id;
      } catch {
        log.warn('WebSocket connection rejected: invalid token');
        socket.close(4001, 'Invalid or expired authentication token');
        return;
      }

      log.info({ userId }, 'WebSocket client connected for notifications');

      // ── Create a dedicated ioredis subscriber connection ────────────────
      // ioredis requires a separate connection for subscribe mode.
      const subscriber = new RedisClient(
        process.env['REDIS_URL'] ?? 'redis://localhost:6379',
      );

      const channel = notificationChannel(userId);

      // Forward Redis messages to the WebSocket client
      subscriber.on('message', (chan: string, message: string) => {
        if (chan === channel && socket.readyState === socket.OPEN) {
          socket.send(message);
        }
      });

      subscriber.on('error', (err: Error) => {
        log.error({ userId, err }, 'Redis subscriber error in WebSocket handler');
      });

      await subscriber.subscribe(channel);
      log.debug({ userId, channel }, 'Subscribed to Redis notification channel');

      // ── Handle WebSocket lifecycle ───────────────────────────────────────

      // Send a confirmation ping so the client knows the connection is live
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: 'connected', userId }));
      }

      socket.on('close', async () => {
        log.info({ userId }, 'WebSocket client disconnected');
        try {
          await subscriber.unsubscribe(channel);
          subscriber.disconnect();
        } catch (err) {
          log.warn({ userId, err }, 'Error while cleaning up Redis subscriber');
        }
      });

      socket.on('error', (err: Error) => {
        log.error({ userId, err }, 'WebSocket error');
      });
    },
  );
}
