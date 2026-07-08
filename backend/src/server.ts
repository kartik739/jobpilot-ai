import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
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
import { manualJobRoutes } from './api/routes/manualJobs.js';
import { llmProviderRoutes } from './api/routes/llmProvider.js';
import { exportRoutes } from './api/routes/export.js';
import { accountRoutes } from './api/routes/account.js';
import { metricsRoutes } from './api/routes/metrics.js';

// Initialize error tracking as early as possible so the SDK can instrument
// Node.js modules before they are first imported by other parts of the app.
initErrorTracking();

export async function buildApp(opts: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    // Use our configured pino logger instance instead of the default
    loggerInstance: logger,
    ...opts,
  });

  // CORS — only allow requests from the configured frontend origin (Req 33.3)
  await app.register(cors, {
    origin: process.env['FRONTEND_ORIGIN'] ?? false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Security headers on every response (Req 33.4)
  await app.register(helmet, {
    // HSTS: 2 years, include sub-domains
    hsts: {
      maxAge: 63072000,
      includeSubDomains: true,
    },
    // Prevent MIME-type sniffing
    noSniff: true,
    // Disallow framing of the app
    frameguard: { action: 'deny' },
    // CSP tuned for a Next.js frontend (allow same-origin assets, inline
    // styles/scripts needed by Next.js are explicitly permitted as needed)
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
  });

  // JWT plugin — secret comes from environment; fall back to a dev placeholder
  await app.register(jwt, {
    secret: process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production',
  });

  // WebSocket plugin — must be registered before any websocket routes
  await app.register(websocket);

  // Redis client — used for refresh token storage and rate limiting
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');

  // Per-IP and per-user API rate limiting (Req 33.5)
  // Disabled in test environment to avoid interfering with test suites that
  // make many repeated requests.
  if (process.env['NODE_ENV'] !== 'test') {
    await app.register(rateLimit, {
      global: true,
      max: parseInt(process.env['RATE_LIMIT_MAX'] ?? '100', 10),
      timeWindow: parseInt(process.env['RATE_LIMIT_WINDOW_MS'] ?? '60000', 10),
      redis,
      // Key on authenticated user ID when available; otherwise fall back to IP
      keyGenerator: (req) => {
        const user = (req as { user?: { id?: string } }).user;
        if (user?.id) return `user:${user.id}`;
        return `ip:${req.ip}`;
      },
      // Shape the 429 response body
      errorResponseBuilder: (_req, context) => ({
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      }),
      // Expose rate-limit headers on normal responses and Retry-After on 429
      addHeadersOnExceeding: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
      },
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
    });
  }

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

  // Manual job URL override routes
  await app.register(manualJobRoutes);

  // LLM provider settings routes
  await app.register(llmProviderRoutes);

  // Data export route
  await app.register(exportRoutes);

  // Account management routes (account deletion)
  await app.register(accountRoutes, { redis });

  // Prometheus metrics endpoint — GET /metrics (Req 30.3)
  await app.register(metricsRoutes);

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
