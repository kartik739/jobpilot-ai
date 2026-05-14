import pino, { type Logger } from 'pino';

const isDev = process.env['NODE_ENV'] !== 'production';

const transport = isDev
  ? pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    })
  : undefined;

const pinoOptions: pino.LoggerOptions = {
  level: process.env['LOG_LEVEL'] ?? 'info',
};

export const logger: Logger = transport
  ? pino(pinoOptions, transport)
  : pino(pinoOptions);

/**
 * Create a child logger with additional bound context fields.
 * Useful for scoping logs to a specific request, user, or operation.
 *
 * @example
 * const log = createChildLogger({ requestId: 'abc', userId: '123' });
 * log.info('Processing job application');
 */
export function createChildLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}

export default logger;
