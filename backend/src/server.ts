import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';

export async function buildApp(opts: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
    ...opts,
  });

  await app.register(cors);
  await app.register(helmet);

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
