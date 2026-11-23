import { Router, Request, Response } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth.js';
import { getRetentionPolicy, updateRetentionPolicy } from '../services/settings.service.js';
import { prisma } from '../db.js';

const router = Router();

router.get('/retention', authenticate, authorizeRoles('admin'), async (_req: Request, res: Response) => {
  try {
    const [policy, history] = await Promise.all([
      getRetentionPolicy(),
      prisma.securityAuditLog.findMany({
        where: { eventType: 'SYSTEM_SETTING_UPDATED' }, orderBy: { createdAt: 'desc' }, take: 20,
        select: { createdAt: true, email: true, details: true }
      })
    ]);
    return res.json({ ...policy, history });
  } catch (error) {
    console.error('[AdminSettings] Failed to load retention policy:', error);
    return res.status(500).json({ error: 'Could not load retention settings.' });
  }
});

router.post('/retention/preview', authenticate, authorizeRoles('admin'), async (req: Request, res: Response) => {
  const { recordingRetentionDays, transcriptRetentionDays } = req.body || {};
  const valid = (value: unknown) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 3650;
  if (!valid(recordingRetentionDays) || !valid(transcriptRetentionDays)) {
    return res.status(400).json({ error: 'Retention periods must be whole numbers from 1 to 3650 days.' });
  }
  try {
    const now = Date.now();
    const recordingCutoff = new Date(now - recordingRetentionDays * 86400000);
    const transcriptCutoff = new Date(now - transcriptRetentionDays * 86400000);
    const [recordings, transcripts] = await Promise.all([
      prisma.callRecording.count({ where: { recordingStatus: { not: 'deleted' }, createdAt: { lte: recordingCutoff } } }),
      prisma.callTranscript.count({ where: { timestamp: { lte: transcriptCutoff } } })
    ]);
    return res.json({ recordings, transcripts });
  } catch (error) {
    console.error('[AdminSettings] Failed to preview retention policy:', error);
    return res.status(500).json({ error: 'Could not preview retention impact.' });
  }
});

router.put('/retention', authenticate, authorizeRoles('admin'), async (req: Request, res: Response) => {
  const { recordingRetentionDays, transcriptRetentionDays } = req.body || {};
  const valid = (value: unknown) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 3650;
  if (!valid(recordingRetentionDays) || !valid(transcriptRetentionDays)) {
    return res.status(400).json({ error: 'Retention periods must be whole numbers from 1 to 3650 days.' });
  }
  try {
    const policy = await updateRetentionPolicy(
      recordingRetentionDays, transcriptRetentionDays, req.user!, req.ip
    );
    return res.json(policy);
  } catch (error) {
    console.error('[AdminSettings] Failed to save retention policy:', error);
    return res.status(500).json({ error: 'Could not save retention settings.' });
  }
});

export default router;
