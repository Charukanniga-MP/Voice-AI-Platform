import { prisma } from '../db.js';

export interface RetentionPolicy {
  recordingRetentionDays: number;
  transcriptRetentionDays: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

function getDefaults() {
  return {
    recordingRetentionDays: Math.max(1, Number(process.env.RECORDING_RETENTION_DAYS) || 90),
    transcriptRetentionDays: Math.max(1, Number(process.env.TRANSCRIPT_RETENTION_DAYS) || 90)
  };
}

export async function getRetentionPolicy(): Promise<RetentionPolicy> {
  const defaults = getDefaults();
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ['recordingRetentionDays', 'transcriptRetentionDays'] } }
  });
  const byKey = new Map(rows.map(row => [row.key, row]));
  const recording = byKey.get('recordingRetentionDays');
  const transcript = byKey.get('transcriptRetentionDays');
  const changed = [recording, transcript].filter(Boolean).sort((a, b) => b!.updatedAt.getTime() - a!.updatedAt.getTime())[0];
  return {
    recordingRetentionDays: recording ? Math.max(1, Number(recording.value) || defaults.recordingRetentionDays) : defaults.recordingRetentionDays,
    transcriptRetentionDays: transcript ? Math.max(1, Number(transcript.value) || defaults.transcriptRetentionDays) : defaults.transcriptRetentionDays,
    updatedAt: changed?.updatedAt.toISOString() || null,
    updatedBy: changed?.updatedBy || null
  };
}

export async function updateRetentionPolicy(
  recordingRetentionDays: number,
  transcriptRetentionDays: number,
  user: { id: string; name: string; email: string },
  ipAddress?: string
): Promise<RetentionPolicy> {
  const previous = await getRetentionPolicy();
  const changedAt = new Date();
  await prisma.$transaction([
    prisma.appSetting.upsert({
      where: { key: 'recordingRetentionDays' },
      create: { key: 'recordingRetentionDays', value: String(recordingRetentionDays), updatedBy: user.name || user.email },
      update: { value: String(recordingRetentionDays), updatedBy: user.name || user.email }
    }),
    prisma.appSetting.upsert({
      where: { key: 'transcriptRetentionDays' },
      create: { key: 'transcriptRetentionDays', value: String(transcriptRetentionDays), updatedBy: user.name || user.email },
      update: { value: String(transcriptRetentionDays), updatedBy: user.name || user.email }
    }),
    prisma.securityAuditLog.create({
      data: {
        eventType: 'SYSTEM_SETTING_UPDATED', userId: user.id, email: user.email, ipAddress,
        details: JSON.stringify({
          setting: 'retention_policy',
          previous: { recordingRetentionDays: previous.recordingRetentionDays, transcriptRetentionDays: previous.transcriptRetentionDays },
          updated: { recordingRetentionDays, transcriptRetentionDays },
          changedAt: changedAt.toISOString()
        })
      }
    })
  ]);

  const recordings = await prisma.callRecording.findMany({
    where: { recordingStatus: { not: 'deleted' } }, select: { id: true, createdAt: true }
  });
  for (let offset = 0; offset < recordings.length; offset += 100) {
    const batch = recordings.slice(offset, offset + 100);
    await prisma.$transaction(batch.map(recording => prisma.callRecording.update({
      where: { id: recording.id },
      data: { retentionExpiry: new Date(recording.createdAt.getTime() + recordingRetentionDays * 86400000) }
    })));
  }

  return getRetentionPolicy();
}
