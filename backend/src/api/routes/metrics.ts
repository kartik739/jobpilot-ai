/**
 * Prometheus metrics endpoint
 *
 * GET /metrics — returns all registered metrics in Prometheus text format.
 *
 * This endpoint is intentionally unauthenticated so that Prometheus scrapers
 * can access it without credentials. If you need to restrict access, add
 * network-level controls (e.g., allow only the scraper IP).
 *
 * Requirements: 30.3
 */

import type { FastifyInstance } from 'fastify';
import { register } from '../../core/metrics.js';

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (_request, reply) => {
    const metrics = await register.metrics();
    return reply
      .status(200)
      .header('Content-Type', register.contentType)
      .send(metrics);
  });
}
