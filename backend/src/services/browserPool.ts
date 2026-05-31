/**
 * Playwright Browser Pool
 *
 * Manages a fixed pool of Playwright browser instances (3–5 by default). Each
 * caller acquires an isolated `BrowserContext` — no cookies, storage, or cache
 * are shared between sessions. When the pool is exhausted, callers wait in a
 * FIFO queue until a context becomes available.
 *
 * Usage:
 *   const pool = new BrowserPool();
 *   await pool.start();
 *
 *   const result = await withBrowser(pool, async (ctx) => {
 *     const page = await ctx.newPage();
 *     await page.goto('https://example.com');
 *     return page.title();
 *   });
 *
 *   await pool.close();
 *
 * Requirements: 12.11
 */

import { chromium, type Browser, type BrowserContext } from 'playwright';
import { createChildLogger } from '../core/logger.js';

const log = createChildLogger({ service: 'BrowserPool' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum number of browser instances to keep running. */
const MIN_POOL_SIZE = 3;
/** Maximum number of browser instances (= maximum concurrent sessions). */
const MAX_POOL_SIZE = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Internal entry tracking a browser and its currently-checked-out context (if
 * any).  One `BrowserContext` per browser ensures full isolation.
 */
interface BrowserSlot {
  browser: Browser;
  /** `null` when the slot is idle and available for a new session. */
  context: BrowserContext | null;
}

/**
 * A pending waiter — resolve/reject callbacks for a caller blocked in
 * `acquireSession()`.
 */
interface Waiter {
  resolve: (ctx: BrowserContext) => void;
  reject: (err: unknown) => void;
}

// ---------------------------------------------------------------------------
// BrowserPool
// ---------------------------------------------------------------------------

/**
 * Pool of Playwright browser instances.
 *
 * Each `BrowserContext` issued by `acquireSession()` is freshly created with
 * isolated cookies, local storage, and cache — matching Playwright's
 * `browser.newContext()` default isolation semantics.
 *
 * Lifecycle:
 *   1. `new BrowserPool(options?)`
 *   2. `await pool.start()` — launches browser instances
 *   3. `acquireSession()` / `releaseSession()` — or use `withBrowser()` helper
 *   4. `await pool.close()` — shuts down all browsers and rejects pending waiters
 */
export class BrowserPool {
  private readonly minSize: number;
  private readonly maxSize: number;

  private slots: BrowserSlot[] = [];
  private waiters: Waiter[] = [];
  private started = false;
  private closed = false;

  constructor(options?: { minSize?: number; maxSize?: number }) {
    this.minSize = options?.minSize ?? MIN_POOL_SIZE;
    this.maxSize = options?.maxSize ?? MAX_POOL_SIZE;

    if (this.minSize < 1) throw new RangeError('minSize must be >= 1');
    if (this.maxSize < this.minSize)
      throw new RangeError('maxSize must be >= minSize');
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Launch `minSize` browser instances and prepare the pool for use.
   * Must be called once before any `acquireSession()` call.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    log.info({ minSize: this.minSize, maxSize: this.maxSize }, 'Starting browser pool');

    // Launch browsers up to minSize in parallel
    const launchers = Array.from({ length: this.minSize }, () => this.launchSlot());
    await Promise.all(launchers);

    log.info({ slotCount: this.slots.length }, 'Browser pool ready');
  }

  /**
   * Shut down all browser instances and reject any queued waiters.
   * Safe to call multiple times.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    log.info({ slotCount: this.slots.length, waiters: this.waiters.length }, 'Closing browser pool');

    // Drain the wait queue
    const poolClosedError = new Error('BrowserPool has been closed');
    for (const waiter of this.waiters) {
      waiter.reject(poolClosedError);
    }
    this.waiters = [];

    // Close all browsers (including any with active contexts)
    await Promise.allSettled(
      this.slots.map(async (slot) => {
        try {
          if (slot.context) {
            await slot.context.close().catch(() => undefined);
            slot.context = null;
          }
          await slot.browser.close();
        } catch (err) {
          log.warn({ err }, 'Error closing browser slot during pool shutdown');
        }
      }),
    );

    this.slots = [];
    log.info('Browser pool closed');
  }

  // ── Session management ─────────────────────────────────────────────────────

  /**
   * Acquire an isolated `BrowserContext`.
   *
   * - If a free slot exists, a new context is created immediately and returned.
   * - If all slots are busy but the pool is below `maxSize`, a new browser is
   *   launched and a context from it is returned.
   * - Otherwise the caller is queued and will receive a context once one is
   *   released.
   *
   * Requirements: 12.11
   */
  async acquireSession(): Promise<BrowserContext> {
    if (this.closed) {
      throw new Error('Cannot acquire session: BrowserPool is closed');
    }

    // Fast path — find an idle slot
    const idleSlot = this.slots.find((s) => s.context === null);
    if (idleSlot) {
      return this.checkoutSlot(idleSlot);
    }

    // If we haven't reached maxSize, launch a new browser
    if (this.slots.length < this.maxSize) {
      const slot = await this.launchSlot();
      return this.checkoutSlot(slot);
    }

    // All slots busy — park the caller in the wait queue
    log.debug(
      { queueDepth: this.waiters.length + 1, maxSize: this.maxSize },
      'All browser slots busy — queuing caller',
    );

    return new Promise<BrowserContext>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  /**
   * Release a previously acquired `BrowserContext` back to the pool.
   *
   * The context is closed and discarded so its cookies/storage cannot bleed
   * into the next caller's session — isolation is always fresh.
   *
   * Safe to call multiple times on the same context; redundant calls are
   * silently ignored.
   *
   * Requirements: 12.11
   */
  releaseSession(context: BrowserContext): void {
    const slot = this.slots.find((s) => s.context === context);

    if (!slot) {
      // Already released or not owned by this pool — no-op
      log.debug('releaseSession called with unknown context — ignoring');
      return;
    }

    // Close the used context asynchronously (fire-and-forget); errors are
    // logged but do not propagate to the caller because releaseSession is void.
    context
      .close()
      .catch((err: unknown) => {
        log.warn({ err }, 'Error closing released BrowserContext');
      })
      .finally(() => {
        slot.context = null;

        // Serve the next waiter, if any
        const nextWaiter = this.waiters.shift();
        if (nextWaiter) {
          // Create a fresh context for the waiter
          this.checkoutSlotAsync(slot, nextWaiter);
        }
      });
  }

  // ── Diagnostics ────────────────────────────────────────────────────────────

  /** Number of slots currently checked out (busy). */
  get activeCount(): number {
    return this.slots.filter((s) => s.context !== null).length;
  }

  /** Number of callers waiting for a session. */
  get queueDepth(): number {
    return this.waiters.length;
  }

  /** Total number of browser instances (idle + busy). */
  get slotCount(): number {
    return this.slots.length;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Launch a new Chromium browser and add its slot to the pool.
   * Returns the newly created slot.
   */
  private async launchSlot(): Promise<BrowserSlot> {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    const slot: BrowserSlot = { browser, context: null };
    this.slots.push(slot);

    log.debug({ slotIndex: this.slots.length - 1 }, 'Browser slot launched');
    return slot;
  }

  /**
   * Synchronously mark a slot as busy by creating a fresh isolated context.
   * Returns the context.
   */
  private checkoutSlot(slot: BrowserSlot): Promise<BrowserContext> {
    return slot.browser
      .newContext({
        // Ensure no persistent storage/cookies are carried over between sessions
        storageState: undefined,
      })
      .then((ctx) => {
        slot.context = ctx;
        log.debug({ activeCount: this.activeCount }, 'Browser context checked out');
        return ctx;
      });
  }

  /**
   * Async variant used when serving a queued waiter after a `releaseSession`.
   * Resolves or rejects the waiter's promise.
   */
  private checkoutSlotAsync(slot: BrowserSlot, waiter: Waiter): void {
    slot.browser
      .newContext({ storageState: undefined })
      .then((ctx) => {
        slot.context = ctx;
        log.debug({ activeCount: this.activeCount }, 'Browser context handed to queued waiter');
        waiter.resolve(ctx);
      })
      .catch((err: unknown) => {
        log.error({ err }, 'Failed to create browser context for queued waiter');
        waiter.reject(err);
        // Slot remains idle so future callers can still use this browser
      });
  }
}

// ---------------------------------------------------------------------------
// withBrowser helper
// ---------------------------------------------------------------------------

/**
 * Acquire a `BrowserContext` from `pool`, execute `fn` with it, then
 * **always** release the context back — even when `fn` throws.
 *
 * ```ts
 * const title = await withBrowser(pool, async (ctx) => {
 *   const page = await ctx.newPage();
 *   await page.goto('https://example.com');
 *   return page.title();
 * });
 * ```
 *
 * Requirements: 12.11
 */
export async function withBrowser<T>(
  pool: BrowserPool,
  fn: (context: BrowserContext) => Promise<T>,
): Promise<T> {
  const context = await pool.acquireSession();

  try {
    return await fn(context);
  } finally {
    pool.releaseSession(context);
  }
}
