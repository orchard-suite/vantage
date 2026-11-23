/**
 * A fixed-window rate limiter in process memory, keyed by whatever the
 * caller chooses (a token id, a client address). Per pod by design: the
 * limit guards against abuse, not against exact accounting.
 */
export interface RateLimiter {
  /** True when the key may proceed; false when it is over the limit for this window. */
  allow(key: string): boolean;
  size(): number;
}

export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  let sweepAt = now() + windowMs;
  return {
    allow(key) {
      const t = now();
      if (t > sweepAt) {
        for (const [k, w] of windows) if (t - w.start > windowMs) windows.delete(k);
        sweepAt = t + windowMs;
      }
      const w = windows.get(key);
      if (!w || t - w.start > windowMs) {
        windows.set(key, { start: t, count: 1 });
        return true;
      }
      w.count++;
      return w.count <= limit;
    },
    size: () => windows.size,
  };
}

export function clientAddress(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}
