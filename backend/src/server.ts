import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { Redis } from 'ioredis';
import { logger } from './core/logger.js';
import { initErrorTracking } from './core/errorTracking.js';
import { authRoutes } from './api/routes/auth.js';
import { profileRoutes } from './api/routes/profile.js';
import { resumeRoutes } from './api/routes/resumes.js';
import { jobRoutes } from './api/routes/jobs.js';
import { agentRoutes } from './api/routes/agent.js';
import { applicationRoutes } from './api/routes/applications.js';
import { gmailRoutes } from './api/routes/gmail.js';
import { analyticsRoutes } from './api/routes/analytics.js';
import { notificationRoutes } from './api/routes/notifications.js';
import { sourcesRoutes } from './api/routes/sources.js';

// Initialize error tracking as early as possible so the SDK can instrument
// Node.js modules before they are first imported by other parts of the app.
initErrorTracking();

export async function buildApp(opts: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    // Use our configured pino logger instance instead of the default
    loggerInstance: logger,
    ...opts,
  });

  await app.register(cors);
  await app.register(helmet);

  // JWT plugin — secret comes from environment; fall back to a dev placeholder
  await app.register(jwt, {
    secret: process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production',
  });

  // WebSocket plugin — must be registered before any websocket routes
  await app.register(websocket);

  // Redis client — used for refresh token storage
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');

  // Auth routes
  await app.register(authRoutes, { redis });

  // Profile routes
  await app.register(profileRoutes);

  // Resume version routes
  await app.register(resumeRoutes);

  // Job ranking / match routes
  await app.register(jobRoutes);

  // Agent control routes (pause/resume/status)
  await app.register(agentRoutes, { redis });

  // Application tracker routes
  await app.register(applicationRoutes);

  // Gmail OAuth routes
  await app.register(gmailRoutes);

  // Analytics routes
  await app.register(analyticsRoutes);

  // Notification routes (REST + WebSocket)
  await app.register(notificationRoutes, { redis });

  // Job source health routes
  await app.register(sourcesRoutes, { redis });

  // Bind requestId and userId to every request's log context so all downstream
  // log calls automatically include these fields without repeating them.
  app.addHook('onRequest', async (req) => {
    req.log = req.log.child({
      requestId: req.id,
      // req.user is populated by @fastify/jwt — may not be present on unauthenticated routes
      userId: (req as { user?: { id?: string } }).user?.id ?? undefined,
    });
  });

  app.addHook('onReady', async () => {
    app.log.info('Server is ready');
  });

  app.addHook('onClose', async () => {
    app.log.info('Server is closing');
  });

  return app;
}

export async function startServer(): Promise<void> {
  const app = await buildApp();
  const port = parseInt(process.env['PORT'] ?? '3000', 10);

  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  startServer();
}
