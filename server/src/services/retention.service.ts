import fs from 'fs';
import path from 'path';
import { prisma } from '../db.js';

let interval: NodeJS.Timeout | null = null;
const RECORDINGS_DIR = path.resolve(process.cwd(), 'uploads', 'recordings');
const transcriptRetentionDays = Math.max(1, Number(process.env.TRANSCRIPT_RETENTION_DAYS) || 90);

/** Purges expired audio and transcript content while retaining call metadata/audit history. */
export async function purgeExpiredCallData(): Promise<void> {
  const expiredRecordings = await prisma.callRecording.findMany({
    where: { recordingStatus: { not: 'deleted' }, retentionExpiry: { lte: new Date() } }
  });
  for (const recording of expiredRecordings) {
    if (recording.storagePath) {
      const resolved = path.resolve(recording.storagePath);
      if (resolved.startsWith(`${RECORDINGS_DIR}${path.sep}`) && fs.existsSync(resolved)) fs.unlinkSync(resolved);
    }
    await prisma.callRecording.update({ where: { id: recording.id }, data: {
      recordingStatus: 'deleted', storagePath: null, deletedAt: new Date(), deletedBy: 'retention-policy'
    } });
    await prisma.recordingAuditLog.create({ data: {
      recordingId: recording.id, action: 'DELETE', performedBy: 'retention-policy', userRole: 'system',
      details: 'Recording audio purged after its configured retention period.'
    } });
  }

  const transcriptCutoff = new Date(Date.now() - transcriptRetentionDays * 24 * 60 * 60 * 1000);
  const oldTranscripts = await prisma.callTranscript.findMany({
    where: { timestamp: { lte: transcriptCutoff } }, select: { id: true }
  });
  if (oldTranscripts.length) {
    await prisma.callTranscript.deleteMany({ where: { id: { in: oldTranscripts.map(row => row.id) } } });
  }
}

export function initRetentionScheduler(): void {
  const run = () => purgeExpiredCallData().catch(error => console.error('[Retention] Cleanup failed:', error));
  run();
  if (interval) clearInterval(interval);
  interval = setInterval(run, 60 * 60 * 1000);
  interval.unref?.();
}

export function stopRetentionScheduler(): void {
  if (interval) clearInterval(interval);
  interval = null;
}
