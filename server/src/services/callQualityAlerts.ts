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
  const existing = await prisma.callQualityAlertSettings.findUnique({
    where: { id: 'default' }
  });
  if (existing) return existing;

  return prisma.callQualityAlertSettings.create({
    data: {
      id: 'default',
      speechRecognitionThreshold: 5,
      droppedCallThreshold: 5,
      recordingUploadThreshold: 3,
      windowMinutes: 60
    }
  });
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
  const [count, state] = await Promise.all([
    prisma.callQualityEvent.count({ where: { eventType, createdAt: { gte: cutoff } } }),
    prisma.callQualityAlertState.findUnique({ where: { eventType } })
  ]);
  const lastAlertedAt = state?.lastAlertedAt ? new Date(state.lastAlertedAt) : null;

  if (count < thresholdByType[eventType]) return null;
  if (lastAlertedAt && lastAlertedAt.getTime() > cutoff.getTime()) return null;

  await prisma.callQualityAlertState.upsert({
    where: { eventType },
    create: { eventType, lastAlertedAt: now },
    update: { lastAlertedAt: now }
  });

  return {
    eventType,
    count,
    threshold: thresholdByType[eventType],
    windowMinutes: settings.windowMinutes,
    triggeredAt: now.toISOString()
  };
}
