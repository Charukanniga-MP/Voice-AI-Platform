/**
 * KAIRA Voice AI Platform - Notification Routes
 * Endpoints for fetching, reading, and clearing user/role notifications.
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { notificationService } from '../services/notification.service.js';

const router = Router();

// Enforce authentication on all notification routes
router.use(authenticate);

/**
 * GET /api/notifications
 * Fetch notifications for authenticated user/role with unread count
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { unreadOnly, limit } = req.query;

    const result = await notificationService.getNotifications({
      userId: user?.id,
      role: user?.role,
      unreadOnly: unreadOnly === 'true',
      limit: limit ? parseInt(limit as string, 10) : 50
    });

    res.json({
      success: true,
      notifications: result.notifications,
      unreadCount: result.unreadCount
    });
  } catch (err: any) {
    console.error('[Notifications] Fetch error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve notifications.' });
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Mark a single notification as read
 */
router.patch('/:id/read', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updated = await notificationService.markAsRead(id);
    if (!updated) {
      res.status(404).json({ error: 'Notification not found.' });
      return;
    }
    res.json({ success: true, notification: updated });
  } catch (err: any) {
    console.error('[Notifications] Mark as read error:', err.message);
    res.status(500).json({ error: 'Failed to update notification status.' });
  }
});

/**
 * POST /api/notifications/mark-all-read
 * Mark all notifications for the current user/role as read
 */
router.post('/mark-all-read', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const count = await notificationService.markAllAsRead({
      userId: user?.id,
      role: user?.role
    });

    res.json({ success: true, updatedCount: count });
  } catch (err: any) {
    console.error('[Notifications] Mark all as read error:', err.message);
    res.status(500).json({ error: 'Failed to mark notifications as read.' });
  }
});

export default router;
