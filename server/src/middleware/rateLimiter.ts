import { Request, Response, NextFunction } from 'express';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  message: { error: string };
  standardHeaders?: boolean;
  legacyHeaders?: boolean;
}

function createRateLimiter(options: RateLimitOptions) {
  const hits = new Map<string, { count: number; resetTime: number }>();

  // Cleanup expired entries periodically
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (now > record.resetTime) {
        hits.delete(key);
      }
    }
  }, options.windowMs);
  if (timer.unref) timer.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = hits.get(ip);

    if (!record || now > record.resetTime) {
      hits.set(ip, { count: 1, resetTime: now + options.windowMs });
      return next();
    }

    record.count++;
    if (record.count > options.max) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      res.status(429).json(options.message);
      return;
    }

    next();
  };
}

/**
 * Authentication rate limiter: 15 attempts per 15 minutes per IP.
 * Mitigates brute-force credential stuffing and password guessing.
 */
export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    error: 'Too many authentication attempts. Please try again in 15 minutes.'
  }
});

/**
 * Telephony rate limiter: 30 outbound call triggers per hour per IP.
 * Mitigates telecom toll fraud and telephony abuse.
 */
export const telephonyLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // Max 30 outbound calls per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Outbound telephony rate limit exceeded. Please wait before placing more calls.'
  }
});

/**
 * General API rate limiter: 300 requests per 15 minutes per IP.
 * Prevents denial of service and API spamming.
 */
export const apiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 400, // Limit each IP to 400 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please slow down.'
  }
});

