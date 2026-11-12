import type { Clock } from './clock.js';

/**
 * Fixed-window in-memory rate limiter.
 * Keys (such as client IPs) live only in memory for one window and are never persisted.
 * In production this would be backed by Redis or the edge (WAF) so limits hold across instances.
 */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  take(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.clock();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    return { allowed: window.count <= this.limit, retryAfterSeconds };
  }

  /** Drop expired windows so memory does not grow with the number of distinct keys. */
  prune(): void {
    const now = this.clock();
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
