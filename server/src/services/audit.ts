import { prisma } from '../db.js';

export type SecurityEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'ACCOUNT_LOCKED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_SUCCESS'
  | 'PASSWORD_RESET_FAILED'
  | 'UNAUTHORIZED_ACCESS_ATTEMPT'
  | 'SESSION_EXPIRED'
  | 'LOGOUT';

export interface AuditLogParams {
  eventType: SecurityEventType;
  userId?: string | null;
  email?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: string | null;
}

export async function logSecurityEvent(params: AuditLogParams): Promise<void> {
  try {
    const cleanEmail = params.email ? params.email.trim().toLowerCase() : null;
    const cleanDetails = params.details ? params.details.slice(0, 1000) : null;

    await prisma.securityAuditLog.create({
      data: {
        eventType: params.eventType,
        userId: params.userId || null,
        email: cleanEmail,
        ipAddress: params.ipAddress ? params.ipAddress.slice(0, 45) : null,
        userAgent: params.userAgent ? params.userAgent.slice(0, 255) : null,
        details: cleanDetails
      }
    });
  } catch (err) {
    // Audit logging should never crash the main application request
    console.warn('[Security Audit] Failed to record audit log:', (err as Error).message);
  }
}
