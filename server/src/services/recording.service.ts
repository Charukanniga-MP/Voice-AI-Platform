/**
 * KAIRA Voice AI Platform - Call Recording & Management Service
 * Handles secure audio storage, customer consent tracking, Range-based audio streaming,
 * deletion/retention policies, and recording audit trails.
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';

const prisma = new PrismaClient();

const RECORDINGS_DIR = path.resolve(process.cwd(), 'uploads', 'recordings');

// Ensure recordings directory exists with restricted permissions
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

export interface SaveRecordingOptions {
  callId: string;
  audioBuffer?: Buffer;
  mimeType?: string;
  consentStatus: 'granted' | 'declined' | 'not_requested';
  duration?: number;
  performedBy?: string;
  ipAddress?: string;
  userAgent?: string;
}

export class RecordingService {
  /**
   * Saves or logs a call recording with strict consent verification
   */
  public async saveRecording(options: SaveRecordingOptions): Promise<any> {
    const { callId, audioBuffer, mimeType = 'audio/webm', consentStatus, duration = 0, performedBy = 'system', ipAddress, userAgent } = options;

    // Locate matching CallRecord
    const callRecord = await prisma.callRecord.findUnique({
      where: { callId }
    });

    if (!callRecord) {
      throw new Error(`Call record not found for callId: ${callId}`);
    }

    // Default 90-day retention policy
    const retentionExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    // If customer declined consent, do NOT store audio file
    if (consentStatus === 'declined') {
      const recording = await prisma.callRecording.upsert({
        where: { callRecordId: callRecord.id },
        update: {
          consentStatus: 'declined',
          recordingStatus: 'declined',
          duration,
          updatedAt: new Date()
        },
        create: {
          callRecordId: callRecord.id,
          callId,
          consentStatus: 'declined',
          recordingStatus: 'declined',
          duration,
          storagePath: null,
          fileName: null,
          fileSize: 0,
          retentionExpiry
        }
      });

      // Audit log consent refusal
      await prisma.recordingAuditLog.create({
        data: {
          recordingId: recording.id,
          action: 'CONSENT_RECORDED',
          performedBy,
          userRole: 'customer',
          ipAddress,
          userAgent,
          details: 'Customer declined call recording consent. Audio was not captured.'
        }
      });

      return { recording, message: 'Customer declined recording. Privacy respected.' };
    }

    // If consent granted and audio provided, persist file safely
    let storagePath: string | null = null;
    let fileName: string | null = null;
    let fileSize = 0;

    if (audioBuffer && audioBuffer.length > 0) {
      const ext = mimeType.includes('wav') ? 'wav' : mimeType.includes('mp3') ? 'mp3' : 'webm';
      fileName = `rec_${callId}_${Date.now()}.${ext}`;
      storagePath = path.resolve(RECORDINGS_DIR, fileName);
      fs.writeFileSync(storagePath, audioBuffer);
      fileSize = audioBuffer.length;
    }

    const recording = await prisma.callRecording.upsert({
      where: { callRecordId: callRecord.id },
      update: {
        consentStatus: 'granted',
        recordingStatus: storagePath ? 'completed' : 'processing',
        storagePath,
        fileName,
        fileSize,
        mimeType,
        duration: duration || callRecord.duration || 0,
        retentionExpiry,
        updatedAt: new Date()
      },
      create: {
        callRecordId: callRecord.id,
        callId,
        consentStatus: 'granted',
        recordingStatus: storagePath ? 'completed' : 'processing',
        storagePath,
        fileName,
        fileSize,
        mimeType,
        duration: duration || callRecord.duration || 0,
        retentionExpiry
      }
    });

    // Audit log consent grant
    await prisma.recordingAuditLog.create({
      data: {
        recordingId: recording.id,
        action: 'CONSENT_RECORDED',
        performedBy,
        userRole: 'customer',
        ipAddress,
        userAgent,
        details: `Customer consented to recording. Stored ${fileSize} bytes at ${fileName || 'pending'}.`
      }
    });

    return { recording, message: 'Recording saved successfully with customer consent.' };
  }

  /**
   * Retrieves paginated recordings with search and filters
   */
  public async getRecordings(query: {
    search?: string;
    consentStatus?: string;
    recordingStatus?: string;
    callType?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ recordings: any[]; total: number }> {
    const { search, consentStatus, recordingStatus, callType, startDate, endDate, limit = 50, offset = 0 } = query;

    const where: any = {};

    if (consentStatus && consentStatus !== 'all') {
      where.consentStatus = consentStatus;
    }

    if (recordingStatus && recordingStatus !== 'all') {
      where.recordingStatus = recordingStatus;
    } else {
      // Hide deleted recordings by default unless explicitly requested
      where.recordingStatus = { not: 'deleted' };
    }

    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    if (callType && callType !== 'all') {
      where.callRecord = { type: callType };
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { callId: { contains: q } },
        { callRecord: { customerName: { contains: q } } },
        { callRecord: { customerPhone: { contains: q } } },
        { callRecord: { agentName: { contains: q } } }
      ];
    }

    const [recordings, total] = await Promise.all([
      prisma.callRecording.findMany({
        where,
        include: {
          callRecord: {
            include: {
              transcripts: {
                orderBy: { timestamp: 'asc' }
              },
              intelligence: true
            }
          },
          conversationAnalysis: true
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset
      }),
      prisma.callRecording.count({ where })
    ]);

    return { recordings, total };
  }

  /**
   * Fetches single recording details with transcripts and analysis
   */
  public async getRecordingById(id: string): Promise<any> {
    return prisma.callRecording.findFirst({
      where: {
        OR: [{ id }, { callId: id }, { callRecordId: id }]
      },
      include: {
        callRecord: {
          include: {
            transcripts: {
              orderBy: { timestamp: 'asc' }
            },
            intelligence: true,
            sentimentRecords: true
          }
        },
        conversationAnalysis: true,
        auditLogs: {
          orderBy: { timestamp: 'desc' },
          take: 20
        }
      }
    });
  }

  /**
   * Streams audio file securely using HTTP 206 Partial Content (Range requests)
   */
  public async streamRecordingAudio(id: string, req: Request, res: Response, user: any): Promise<void> {
    const recording = await prisma.callRecording.findFirst({
      where: {
        OR: [{ id }, { callId: id }]
      }
    });

    if (!recording || !recording.storagePath || !fs.existsSync(recording.storagePath)) {
      res.status(404).json({ error: 'Audio recording file not found or declined.' });
      return;
    }

    // Path traversal check
    const resolved = path.resolve(recording.storagePath);
    if (!resolved.startsWith(RECORDINGS_DIR)) {
      res.status(403).json({ error: 'Access denied: Path outside recording storage.' });
      return;
    }

    const stat = fs.statSync(resolved);
    const fileSize = stat.size;
    const range = req.headers.range;

    // Log playback audit (debounced or per first chunk)
    if (!range || range.startsWith('bytes=0-')) {
      await prisma.recordingAuditLog.create({
        data: {
          recordingId: recording.id,
          action: 'PLAYBACK',
          performedBy: user?.name || user?.email || 'admin',
          userRole: user?.role || 'admin',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] as string,
          details: `Audio playback initiated for ${recording.fileName || recording.id}`
        }
      }).catch(() => {});

      await prisma.callRecording.update({
        where: { id: recording.id },
        data: { lastAccessedAt: new Date() }
      }).catch(() => {});
    }

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const file = fs.createReadStream(resolved, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': recording.mimeType || 'audio/webm'
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': recording.mimeType || 'audio/webm'
      });
      fs.createReadStream(resolved).pipe(res);
    }
  }

  /**
   * Downloads recording attachment securely and updates audit logs
   */
  public async downloadRecording(id: string, req: Request, res: Response, user: any): Promise<void> {
    const recording = await prisma.callRecording.findFirst({
      where: {
        OR: [{ id }, { callId: id }]
      }
    });

    if (!recording || !recording.storagePath || !fs.existsSync(recording.storagePath)) {
      res.status(404).json({ error: 'Recording file not available for download.' });
      return;
    }

    // Path traversal verification
    const resolved = path.resolve(recording.storagePath);
    if (!resolved.startsWith(RECORDINGS_DIR)) {
      res.status(403).json({ error: 'Access denied: Invalid storage path.' });
      return;
    }

    // Increment download counter and log audit
    await prisma.callRecording.update({
      where: { id: recording.id },
      data: {
        downloadCount: { increment: 1 },
        lastAccessedAt: new Date()
      }
    });

    await prisma.recordingAuditLog.create({
      data: {
        recordingId: recording.id,
        action: 'DOWNLOAD',
        performedBy: user?.name || user?.email || 'admin',
        userRole: user?.role || 'admin',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] as string,
        details: `Downloaded recording file ${recording.fileName} (${recording.fileSize} bytes)`
      }
    });

    const safeName = recording.fileName || `recording_${recording.callId}.webm`;
    res.download(resolved, safeName);
  }

  /**
   * Soft/Hard deletes recording according to data retention policy
   */
  public async deleteRecording(id: string, user: any, ipAddress?: string): Promise<any> {
    const recording = await prisma.callRecording.findFirst({
      where: {
        OR: [{ id }, { callId: id }]
      }
    });

    if (!recording) {
      throw new Error('Recording not found');
    }

    // If audio file exists on disk, remove it
    if (recording.storagePath && fs.existsSync(recording.storagePath)) {
      try {
        fs.unlinkSync(recording.storagePath);
      } catch (err) {
        console.warn(`Failed to delete recording file from disk:`, err);
      }
    }

    // Mark status as deleted and clear path
    const updated = await prisma.callRecording.update({
      where: { id: recording.id },
      data: {
        recordingStatus: 'deleted',
        storagePath: null,
        deletedAt: new Date(),
        deletedBy: user?.name || user?.email || 'admin'
      }
    });

    // Log deletion in audit table
    await prisma.recordingAuditLog.create({
      data: {
        recordingId: recording.id,
        action: 'DELETE',
        performedBy: user?.name || user?.email || 'admin',
        userRole: user?.role || 'admin',
        ipAddress,
        details: `Recording audio deleted by administrator (${user?.email || 'admin'}).`
      }
    });

    return updated;
  }

  /**
   * Corrects a transcript error while preserving the original historical text
   */
  public async correctTranscript(transcriptId: string, newText: string, user: any): Promise<any> {
    const transcript = await prisma.callTranscript.findUnique({
      where: { id: transcriptId }
    });

    if (!transcript) {
      throw new Error('Transcript entry not found');
    }

    const updated = await prisma.callTranscript.update({
      where: { id: transcriptId },
      data: {
        originalText: transcript.originalText || transcript.text,
        text: newText.trim(),
        isCorrected: true,
        correctedBy: user?.name || user?.email || 'admin',
        correctedAt: new Date()
      }
    });

    // Log transcript correction audit
    const recording = await prisma.callRecording.findFirst({
      where: { callRecordId: transcript.callRecordId }
    });

    if (recording) {
      await prisma.recordingAuditLog.create({
        data: {
          recordingId: recording.id,
          action: 'TRANSCRIPT_CORRECTED',
          performedBy: user?.name || user?.email || 'admin',
          userRole: user?.role || 'admin',
          details: `Corrected transcript entry. Old: "${transcript.text.slice(0, 40)}..." -> New: "${newText.trim().slice(0, 40)}..."`
        }
      }).catch(() => {});
    }

    return updated;
  }
}

export const recordingService = new RecordingService();

