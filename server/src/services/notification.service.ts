/**
 * KAIRA Voice AI Platform - Centralized Notification Service
 * Manages persistent database notifications for incoming calls, callbacks,
 * escalations, support tickets, and system alerts with real-time Socket.IO dispatch.
 */

import { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';

const prisma = new PrismaClient();

export type NotificationType = 'incoming_call' | 'callback' | 'escalation' | 'support_ticket' | 'system';
export type NotificationRole = 'customer' | 'agent' | 'admin' | 'all';

export interface CreateNotificationInput {
  userId?: string | null;
  role?: NotificationRole | null;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any> | string | null;
  dedupKey?: string | null;
}

export class NotificationService {
  private io: SocketIOServer | null = null;

  public setSocketServer(io: SocketIOServer) {
    this.io = io;
  }

  /**
   * Create and persist a notification with optional deduplication and real-time socket delivery
   */
  public async createNotification(input: CreateNotificationInput) {
    try {
      const dataStr = input.data
        ? typeof input.data === 'string'
          ? input.data
          : JSON.stringify(input.data)
        : null;

      // Deduplication check if dedupKey provided
      if (input.dedupKey) {
        const existing = await prisma.notification.findUnique({
          where: { dedupKey: input.dedupKey }
        });
        if (existing) {
          // If already exists and unread, return it
          return existing;
        }
      }

      const notification = await prisma.notification.create({
        data: {
          userId: input.userId || null,
          role: input.role || 'all',
          type: input.type,
          title: input.title,
          message: input.message,
          data: dataStr,
          dedupKey: input.dedupKey || null,
          read: false
        }
      });

      // Real-time broadcast via Socket.IO if initialized
      if (this.io) {
        const payload = {
          ...notification,
          parsedData: input.data ? (typeof input.data === 'string' ? JSON.parse(input.data) : input.data) : null
        };

        if (input.userId) {
          this.io.to(`user:${input.userId}`).emit('notification:new', payload);
        } else if (input.role && input.role !== 'all') {
          this.io.to(`role:${input.role}`).emit('notification:new', payload);
          // If role is agent, also notify admins
          if (input.role === 'agent') {
            this.io.to('role:admin').emit('notification:new', payload);
          }
        } else {
          // Broadcast to all authenticated rooms
          this.io.to('role:admin').emit('notification:new', payload);
          this.io.to('role:agent').emit('notification:new', payload);
        }
      }

      return notification;
    } catch (err: any) {
      console.error('[NotificationService] Error creating notification:', err.message);
      return null;
    }
  }

  /**
   * Get notifications for a user based on their ID and Role
   */
  public async getNotifications(params: {
    userId?: string;
    role?: string;
    unreadOnly?: boolean;
    limit?: number;
  }) {
    const { userId, role, unreadOnly = false, limit = 50 } = params;

    const whereConditions: any[] = [];

    // Filter by user ID if provided
    if (userId) {
      whereConditions.push({ userId });
    }

    // Role-based visibility
    if (role === 'admin') {
      whereConditions.push({ role: { in: ['admin', 'agent', 'all'] } });
    } else if (role === 'agent') {
      whereConditions.push({ role: { in: ['agent', 'all'] } });
    } else if (role === 'customer') {
      whereConditions.push({ role: { in: ['customer', 'all'] } });
    }

    const where: any = {
      OR: whereConditions.length > 0 ? whereConditions : undefined
    };

    if (unreadOnly) {
      where.read = false;
    }

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit
      }),
      prisma.notification.count({
        where: {
          ...where,
          read: false
        }
      })
    ]);

    return {
      notifications,
      unreadCount
    };
  }

  /**
   * Mark a single notification as read
   */
  public async markAsRead(id: string) {
    try {
      const updated = await prisma.notification.update({
        where: { id },
        data: { read: true }
      });
      return updated;
    } catch (err: any) {
      console.error(`[NotificationService] Failed to mark ${id} as read:`, err.message);
      return null;
    }
  }

  /**
   * Mark all notifications matching user or role as read
   */
  public async markAllAsRead(params: { userId?: string; role?: string }) {
    const { userId, role } = params;
    const whereConditions: any[] = [];

    if (userId) {
      whereConditions.push({ userId });
    }
    if (role === 'admin') {
      whereConditions.push({ role: { in: ['admin', 'agent', 'all'] } });
    } else if (role === 'agent') {
      whereConditions.push({ role: { in: ['agent', 'all'] } });
    } else if (role === 'customer') {
      whereConditions.push({ role: { in: ['customer', 'all'] } });
    }

    const where: any = {
      read: false,
      OR: whereConditions.length > 0 ? whereConditions : undefined
    };

    const result = await prisma.notification.updateMany({
      where,
      data: { read: true }
    });

    return result.count;
  }
}

export const notificationService = new NotificationService();
