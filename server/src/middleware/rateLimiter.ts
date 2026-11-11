import rateLimit from 'express-rate-limit';

/**
 * Authentication rate limiter: 15 attempts per 15 minutes per IP.
 * Mitigates brute-force credential stuffing and password guessing.
 */
export const authLimiter = rateLimit({
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
export const telephonyLimiter = rateLimit({
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
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 400, // Limit each IP to 400 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please slow down.'
  }
});

