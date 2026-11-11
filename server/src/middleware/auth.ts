import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../db.js';
import { logSecurityEvent } from '../services/audit.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'agent' | 'customer';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function generateToken(user: AuthUser, expiresIn = env.JWT_EXPIRES_IN): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    },
    env.JWT_SECRET,
    { expiresIn: expiresIn as any }
  );
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Authentication required. No token provided.',
      code: 'NO_TOKEN'
    });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AuthUser;

    // Verify user exists in database and account is not locked
    const dbUser = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, name: true, role: true, lockedUntil: true }
    });

    if (!dbUser) {
      res.status(401).json({
        error: 'Account no longer exists.',
        code: 'USER_NOT_FOUND'
      });
      return;
    }

    if (dbUser.lockedUntil && dbUser.lockedUntil > new Date()) {
      res.status(429).json({
        error: 'Account is temporarily locked due to failed attempts. Please try again later.',
        code: 'ACCOUNT_LOCKED'
      });
      return;
    }

    // Always use the server-verified role from DB
    req.user = {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role as any
    };

    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({
        error: 'Your session has expired. Please log in again.',
        code: 'SESSION_EXPIRED'
      });
      return;
    }

    res.status(401).json({
      error: 'Invalid or malformed authentication token.',
      code: 'INVALID_TOKEN'
    });
  }
}

export function requireRole(allowedRoles: Array<'admin' | 'agent' | 'customer'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required.',
        code: 'UNAUTHENTICATED'
      });
      return;
    }

    // Server-verified identity check
    if (!allowedRoles.includes(req.user.role)) {
      logSecurityEvent({
        eventType: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        userId: req.user.id,
        email: req.user.email,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'] as string,
        details: `Role '${req.user.role}' attempted unauthorized access to ${req.method} ${req.originalUrl || req.path}`
      });

      res.status(403).json({
        error: `Access denied. Role '${req.user.role}' does not have permission to access this resource.`,
        code: 'FORBIDDEN'
      });
      return;
    }

    next();
  };
}
