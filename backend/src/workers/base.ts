import { logger } from '../core/logger.js';
import {
  discoveryQueue,
  applicationQueue,
  emailQueue,
  analyticsQueue,
} from './queue.js';

export type AgentTaskType =
  | 'discover_jobs'
  | 'rank_jobs'
  | 'optimize_resume'
  | 'generate_cover_letter'
  | 'submit_application'
  | 'monitor_emails'
  | 'update_analytics'
  | 'retry_failed'
  | 'generate_interview_prep';

interface EnqueueOptions {
  priority?: number;
  delay?: number;
}

// Map each task type to its queue
const QUEUE_MAP: Record<AgentTaskType, 'discovery' | 'application' | 'email' | 'analytics'> = {
  discover_jobs:          'discovery',
  rank_jobs:              'discovery',
  optimize_resume:        'application',
  generate_cover_letter:  'application',
  submit_application:     'application',
  retry_failed:           'application',
  generate_interview_prep:'application',
  monitor_emails:         'email',
  update_analytics:       'analytics',
};

/**
 * Enqueue a task onto the appropriate BullMQ queue based on its type.
 *
 * @param type    - The agent task type that determines which queue to use.
 * @param payload - Arbitrary key/value data passed to the worker.
 * @param options - Optional priority and delay (in ms).
 */
export async function enqueueTask(
  type: AgentTaskType,
  payload: Record<string, unknown>,
  options: EnqueueOptions = {},
): Promise<void> {
  const queueName = QUEUE_MAP[type];

  const queue =
    queueName === 'discovery'   ? discoveryQueue
    : queueName === 'application' ? applicationQueue
    : queueName === 'email'       ? emailQueue
    : analyticsQueue;

  const jobOptions = {
    ...(options.priority !== undefined && { priority: options.priority }),
    ...(options.delay    !== undefined && { delay:    options.delay }),
  };

  await queue.add(type, payload, jobOptions);

  logger.info(
    { taskType: type, queue: queueName, options },
    `Enqueued task: ${type}`,
  );
}
