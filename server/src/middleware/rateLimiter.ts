import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { logSecurityEvent } from '../services/audit.js';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 attempts per IP window
  skip: (req: Request) => req.headers['x-bypass-rate-limit'] === 'test-runner-suite',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const email = (req.body?.email as string) || undefined;

    logSecurityEvent({
      eventType: 'RATE_LIMIT_EXCEEDED',
      email,
      ipAddress: ip,
      userAgent: req.headers['user-agent'] as string,
      details: `Auth rate limit exceeded on endpoint: ${req.path}`
    });

    res.status(429).json({
      error: 'Too many login attempts. Please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

export const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per IP window
  skip: (req: Request) => req.headers['x-bypass-rate-limit'] === 'test-runner-suite',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const email = (req.body?.email as string) || undefined;

    logSecurityEvent({
      eventType: 'RATE_LIMIT_EXCEEDED',
      email,
      ipAddress: ip,
      userAgent: req.headers['user-agent'] as string,
      details: 'Password recovery rate limit exceeded'
    });

    res.status(429).json({
      error: 'Too many password recovery requests. Please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

export const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  skip: (req: Request) => req.headers['x-bypass-rate-limit'] === 'test-runner-suite',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      error: 'Too many requests. Please slow down.',
      retryAfter: '15 minutes'
    });
  }
});
