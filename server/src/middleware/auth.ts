import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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

const INSECURE_DEFAULT_SECRETS = new Set([
  'kaira-production-secret-voice-key-2025',
  'secret',
  'your-secret-key',
  '123456',
  'changeme',
  'replace-with-a-secure-random-secret-at-least-32-characters-long'
]);

/**
 * Validates the JWT_SECRET configuration on startup or runtime.
 * Throws a fatal error if the secret is missing, too short, or uses a known insecure default.
 */
export function validateJwtConfig(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new Error(
      'FATAL CONFIGURATION ERROR: JWT_SECRET environment variable is missing. ' +
      'A secure JWT secret of at least 32 characters is required to operate KAIRA Voice AI.'
    );
  }

  if (secret.length < 32) {
    throw new Error(
      `FATAL CONFIGURATION ERROR: JWT_SECRET is too short (${secret.length} characters). ` +
      'It must be at least 32 characters long to ensure HMAC-SHA256 signature resistance.'
    );
  }

  if (INSECURE_DEFAULT_SECRETS.has(secret.toLowerCase())) {
    throw new Error(
      'FATAL CONFIGURATION ERROR: Insecure or default JWT_SECRET detected. ' +
      'You must configure a unique, high-entropy secret before starting the server.'
    );
  }

  return secret;
}

export function getJwtSecret(): string {
  return validateJwtConfig();
}

/**
 * Generates a signed JWT with strict role binding and HS256 algorithm.
 */
export function generateToken(user: AuthUser): string {
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
      expiresIn: '7d'
    }
  );
}

/**
 * Express middleware to authenticate incoming requests via Bearer JWT.
 * Enforces HS256 algorithm, checks token expiration, and validates payload integrity.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. No token provided.' });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Empty token provided.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256']
    }) as any;

    if (!decoded || typeof decoded !== 'object' || !decoded.id || !decoded.role) {
      res.status(401).json({ error: 'Invalid token payload.' });
      return;
    }

    const validRoles: Array<AuthUser['role']> = ['admin', 'agent', 'customer'];
    if (!validRoles.includes(decoded.role)) {
      res.status(401).json({ error: 'Tampered token: Invalid role claim.' });
      return;
    }

    req.user = {
      id: String(decoded.id),
      email: String(decoded.email || ''),
      name: String(decoded.name || ''),
      role: decoded.role
    };

    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Session expired. Please log in again.' });
      return;
    }
    res.status(401).json({ error: 'Invalid or manipulated session token.' });
  }
}

/**
 * Role-based access control middleware.
 */
export function requireRole(allowedRoles: Array<'admin' | 'agent' | 'customer'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `Access denied. Role '${req.user.role}' does not have permission to access this resource.`
      });
      return;
    }

    next();
  };
}
