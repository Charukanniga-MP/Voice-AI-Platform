import { prisma } from '../db.js';

export const QUALITY_ALERT_EVENT_TYPES = [
  'speech_recognition_failure',
  'dropped_call',
  'recording_upload_failure'
] as const;

export type QualityAlertEventType = typeof QUALITY_ALERT_EVENT_TYPES[number];

export interface CallQualityAlert {
  eventType: QualityAlertEventType;
  count: number;
  threshold: number;
  windowMinutes: number;
  triggeredAt: string;
}

export interface CallQualityAlertSettings {
  id: string;
  speechRecognitionThreshold: number;
  droppedCallThreshold: number;
  recordingUploadThreshold: number;
  windowMinutes: number;
  updatedAt: Date;
}

export async function getCallQualityAlertSettings(): Promise<CallQualityAlertSettings> {
  const rows = await prisma.$queryRaw<CallQualityAlertSettings[]>`
    SELECT id, speechRecognitionThreshold, droppedCallThreshold,
      recordingUploadThreshold, windowMinutes, updatedAt
    FROM CallQualityAlertSettings WHERE id = 'default' LIMIT 1
  `;
  if (rows[0]) return rows[0];

  const now = new Date();
  await prisma.$executeRaw`
    INSERT OR IGNORE INTO CallQualityAlertSettings
      (id, speechRecognitionThreshold, droppedCallThreshold, recordingUploadThreshold, windowMinutes, updatedAt)
    VALUES ('default', 5, 5, 3, 60, ${now})
  `;
  const created = await prisma.$queryRaw<CallQualityAlertSettings[]>`
    SELECT id, speechRecognitionThreshold, droppedCallThreshold,
      recordingUploadThreshold, windowMinutes, updatedAt
    FROM CallQualityAlertSettings WHERE id = 'default' LIMIT 1
  `;
  return created[0];
}

export async function evaluateCallQualityAlert(eventType: QualityAlertEventType): Promise<CallQualityAlert | null> {
  const settings = await getCallQualityAlertSettings();
  const thresholdByType: Record<QualityAlertEventType, number> = {
    speech_recognition_failure: settings.speechRecognitionThreshold,
    dropped_call: settings.droppedCallThreshold,
    recording_upload_failure: settings.recordingUploadThreshold
  };
  const now = new Date();
  const cutoff = new Date(now.getTime() - settings.windowMinutes * 60_000);
  const [count, states] = await Promise.all([
    prisma.callQualityEvent.count({ where: { eventType, createdAt: { gte: cutoff } } }),
    prisma.$queryRaw<Array<{ lastAlertedAt: Date | null }>>`
      SELECT lastAlertedAt FROM CallQualityAlertState WHERE eventType = ${eventType} LIMIT 1
    `
  ]);
  const lastAlertedAt = states[0]?.lastAlertedAt;

  if (count < thresholdByType[eventType]) return null;
  if (lastAlertedAt && lastAlertedAt.getTime() > cutoff.getTime()) return null;

  await prisma.$executeRaw`
    INSERT INTO CallQualityAlertState (eventType, lastAlertedAt)
    VALUES (${eventType}, ${now})
    ON CONFLICT(eventType) DO UPDATE SET lastAlertedAt = excluded.lastAlertedAt
  `;

  return {
    eventType,
    count,
    threshold: thresholdByType[eventType],
    windowMinutes: settings.windowMinutes,
    triggeredAt: now.toISOString()
  };
}
