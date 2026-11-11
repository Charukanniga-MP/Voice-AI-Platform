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

export function getJwtSecret(): string {
  return env.JWT_SECRET || process.env.JWT_SECRET || 'kaira-production-secret-voice-key-2025';
}

export function validateJwtConfig(): string {
  return getJwtSecret();
}

/**
 * Generates a signed JWT with strict role binding and HS256 algorithm.
 */
export function generateToken(user: AuthUser, expiresIn = env.JWT_EXPIRES_IN): string {
  if (!user || !user.id || !user.role) {
    throw new Error('Cannot generate token: Invalid user payload.');
  }

  const validRoles: Array<AuthUser['role']> = ['admin', 'agent', 'customer'];
  if (!validRoles.includes(user.role)) {
    throw new Error(`Cannot generate token: Invalid role '${user.role}'.`);
  }

  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    },
    getJwtSecret(),
    {
      algorithm: 'HS256',
      expiresIn: (expiresIn || '2h') as any
    }
  );
}

/**
 * Express middleware to authenticate incoming requests via Bearer JWT.
 * Enforces HS256 algorithm, checks token expiration, and validates payload integrity and DB state.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Authentication required. No token provided.',
      code: 'NO_TOKEN'
    });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({
      error: 'Authentication required. Empty token provided.',
      code: 'NO_TOKEN'
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256']
    }) as AuthUser;

    if (!decoded || typeof decoded !== 'object' || !decoded.id || !decoded.role) {
      res.status(401).json({ error: 'Invalid token payload.', code: 'INVALID_TOKEN' });
      return;
    }

    const validRoles: Array<AuthUser['role']> = ['admin', 'agent', 'customer'];
    if (!validRoles.includes(decoded.role)) {
      res.status(401).json({ error: 'Tampered token: Invalid role claim.', code: 'INVALID_TOKEN' });
      return;
    }

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

/**
 * RBAC authorization middleware: restricts endpoint access to specified roles.
 */
export function authorizeRoles(...roles: Array<AuthUser['role']>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required.',
        code: 'UNAUTHENTICATED'
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      logSecurityEvent({
        eventType: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        userId: req.user.id,
        email: req.user.email,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'] as string,
        details: `Access denied to endpoint ${req.path} for role ${req.user.role}. Required: ${roles.join(', ')}`
      });

      res.status(403).json({
        error: 'Access denied. You do not have permission to access this resource.',
        code: 'FORBIDDEN'
      });
      return;
    }

    next();
  };
}

/**
 * Resource Ownership authorization: Ensures user owns the resource or is admin.
 */
export function requireOwnership(getOwnerIdFromReq: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    // Administrators bypass resource ownership restrictions
    if (req.user.role === 'admin') {
      next();
      return;
    }

    const ownerId = getOwnerIdFromReq(req);
    if (!ownerId || ownerId !== req.user.id) {
      logSecurityEvent({
        eventType: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        userId: req.user.id,
        email: req.user.email,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'] as string,
        details: `Unauthorized attempt to access resource belonging to user: ${ownerId}`
      });

      res.status(403).json({
        error: 'Access denied. You can only view and modify your own resources.',
        code: 'OWNERSHIP_VIOLATION'
      });
      return;
    }

    next();
  };
}

export function requireRole(roles: Array<AuthUser['role']> | AuthUser['role']) {
  const roleArray = Array.isArray(roles) ? roles : [roles];
  return authorizeRoles(...roleArray);
}
