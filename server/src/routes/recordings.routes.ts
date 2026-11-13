import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticate, authorizeRoles } from '../middleware/auth.js';
import { recordingService } from '../services/recording.service.js';
import { conversationAnalysisService } from '../services/conversationAnalysis.service.js';
import { agentEvaluationService } from '../services/agentEvaluation.service.js';
import { businessGrowthService } from '../services/businessGrowth.service.js';
import { prisma } from '../db.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

const router = Router();

// Upload call recording audio (requires authentication)
router.post(
  '/upload',
  authenticate,
  upload.single('audio'),
  async (req: Request, res: Response) => {
    try {
      const {
        callId,
        duration,
        consentStatus,
        mimeType
      } = req.body;

      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const result = await recordingService.saveRecording({
        callId: callId || '',
        audioBuffer: req.file?.buffer,
        duration: duration ? parseInt(duration, 10) : undefined,
        consentStatus: (consentStatus as any) || 'not_requested',
        mimeType: mimeType || req.file?.mimetype || 'audio/webm',
        performedBy: user.email || user.name || user.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      return res.status(201).json({
        success: true,
        message: 'Recording saved or consent processed successfully',
        recording: result
      });
    } catch (err: any) {
      console.error('[RecordingsRoute] Error uploading recording:', err);
      return res.status(500).json({ error: err.message || 'Failed to upload recording' });
    }
  }
);

// Get recordings list (Admin & Agents)
router.get(
  '/',
  authenticate,
  authorizeRoles('admin', 'agent'),
  async (req: Request, res: Response) => {
    try {
      const {
        search,
        consentStatus,
        recordingStatus,
        callType,
        startDate,
        endDate,
        limit,
        offset
      } = req.query;

      const results = await recordingService.getRecordings({
        search: search as string | undefined,
        consentStatus: consentStatus as string | undefined,
        recordingStatus: recordingStatus as string | undefined,
        callType: callType as string | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0
      });

      return res.json(results);
    } catch (err: any) {
      console.error('[RecordingsRoute] Error fetching recordings:', err);
      return res.status(500).json({ error: err.message || 'Failed to fetch recordings' });
    }
  }
);

// Export recordings list as CSV
router.get(
  '/export/csv',
  authenticate,
  authorizeRoles('admin'),
  async (req: Request, res: Response) => {
    try {
      const records = await prisma.callRecording.findMany({
        where: { deletedAt: null },
        include: {
          callRecord: {
            include: {
              customer: { select: { id: true, name: true, phone: true } },
              agent: { select: { id: true, name: true, email: true } },
              sentimentRecords: true,
              conversationAnalysis: true,
              agentEvaluation: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      let csv = 'ID,Call ID,Customer,Agent,Duration (s),Consent Status,Recording Status,Audio Quality,Sentiment,Score,Created At\n';
      records.forEach((r: any) => {
        const customer = (r.callRecord?.customer?.name || r.callRecord?.customerPhone || 'Unknown').replace(/,/g, ' ');
        const agent = (r.callRecord?.agent?.name || 'AI Assistant').replace(/,/g, ' ');
        const sentiment = r.callRecord?.sentimentRecords?.[0]?.sentiment || 'Neutral';
        const score = r.callRecord?.agentEvaluation?.overallScore ? `${r.callRecord.agentEvaluation.overallScore}%` : 'N/A';
        const dateStr = new Date(r.createdAt).toISOString();
        csv += `"${r.id}","${r.callId || ''}","${customer}","${agent}",${r.duration || 0},"${r.consentStatus}","${r.recordingStatus}","${r.audioQuality || 'standard'}","${sentiment}","${score}","${dateStr}"\n`;
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="kaira-call-recordings.csv"');
      return res.status(200).send(csv);
    } catch (err: any) {
      console.error('[RecordingsRoute] Error exporting CSV:', err);
      return res.status(500).json({ error: 'Failed to export recordings CSV' });
    }
  }
);

// Get single recording details
router.get(
  '/:id',
  authenticate,
  authorizeRoles('admin', 'agent'),
  async (req: Request, res: Response) => {
    try {
      const recording = await recordingService.getRecordingById(req.params.id);
      if (!recording) {
        return res.status(404).json({ error: 'Recording not found' });
      }
      return res.json({ recording });
    } catch (err: any) {
      console.error('[RecordingsRoute] Error fetching recording:', err);
      return res.status(500).json({ error: err.message || 'Failed to fetch recording' });
    }
  }
);

// Stream recording audio (HTTP 206 Partial Content with Range support)
router.get(
  '/:id/stream',
  authenticate,
  authorizeRoles('admin', 'agent'),
  async (req: Request, res: Response) => {
    try {
      await recordingService.streamRecordingAudio(req.params.id, req, res, req.user);
    } catch (err: any) {
      console.error('[RecordingsRoute] Error streaming audio:', err);
      if (!res.headersSent) {
        return res.status(500).json({ error: err.message || 'Failed to stream audio' });
      }
    }
  }
);

// Download recording audio attachment
router.get(
  '/:id/download',
  authenticate,
  authorizeRoles('admin'),
  async (req: Request, res: Response) => {
    try {
      await recordingService.downloadRecording(req.params.id, req, res, req.user);
    } catch (err: any) {
      console.error('[RecordingsRoute] Error downloading recording:', err);
      if (!res.headersSent) {
        return res.status(500).json({ error: err.message || 'Failed to download recording' });
      }
    }
  }
);

// Soft delete recording
router.delete(
  '/:id',
  authenticate,
  authorizeRoles('admin'),
  async (req: Request, res: Response) => {
    try {
      const result = await recordingService.deleteRecording(req.params.id, req.user, req.ip);
      return res.json({ success: true, message: 'Recording deleted successfully', result });
    } catch (err: any) {
      console.error('[RecordingsRoute] Error deleting recording:', err);
      return res.status(500).json({ error: err.message || 'Failed to delete recording' });
    }
  }
);

// Correct transcript entry with history retention
router.put(
  '/transcript/:transcriptId',
  authenticate,
  authorizeRoles('admin', 'agent'),
  async (req: Request, res: Response) => {
    try {
      const { newText } = req.body;
      if (!newText || typeof newText !== 'string' || !newText.trim()) {
        return res.status(400).json({ error: 'Valid newText is required' });
      }

      const updated = await recordingService.correctTranscript(req.params.transcriptId, newText.trim(), req.user);
      return res.json({ success: true, transcript: updated });
    } catch (err: any) {
      console.error('[RecordingsRoute] Error correcting transcript:', err);
      return res.status(500).json({ error: err.message || 'Failed to correct transcript' });
    }
  }
);

// Trigger AI conversation analysis for a call
router.post(
  '/analysis/:callRecordId',
  authenticate,
  authorizeRoles('admin', 'agent'),
  async (req: Request, res: Response) => {
    try {
      const analysis = await conversationAnalysisService.analyzeCallConversation(req.params.callRecordId);
      return res.json({ success: true, analysis });
    } catch (err: any) {
      console.error('[RecordingsRoute] Error analyzing conversation:', err);
      return res.status(500).json({ error: err.message || 'Failed to analyze conversation' });
    }
  }
);

// Business Growth Analytics
router.get(
  '/growth/analytics',
  authenticate,
  authorizeRoles('admin'),
  async (req: Request, res: Response) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      const data = await businessGrowthService.getGrowthAnalytics(start, end);
      return res.json({ success: true, data });
    } catch (err: any) {
      console.error('[RecordingsRoute] Error fetching growth analytics:', err);
      return res.status(500).json({ error: err.message || 'Failed to fetch business growth analytics' });
    }
  }
);

// Trigger agent performance evaluation for a call
router.post(
  '/evaluations/call/:callRecordId',
  authenticate,
  authorizeRoles('admin'),
  async (req: Request, res: Response) => {
    try {
      const evaluation = await agentEvaluationService.evaluateCall(req.params.callRecordId);
      return res.json({ success: true, evaluation });
    } catch (err: any) {
      console.error('[RecordingsRoute] Error evaluating call:', err);
      return res.status(500).json({ error: err.message || 'Failed to evaluate call' });
    }
  }
);

// Get Agent Performance Scorecard
router.get(
  '/evaluations/agent/:agentId',
  authenticate,
  authorizeRoles('admin', 'agent'),
  async (req: Request, res: Response) => {
    try {
      const scorecard = await agentEvaluationService.getAgentScorecard(req.params.agentId);
      return res.json({ success: true, scorecard });
    } catch (err: any) {
      console.error('[RecordingsRoute] Error fetching agent scorecard:', err);
      return res.status(500).json({ error: err.message || 'Failed to fetch agent scorecard' });
    }
  }
);

// Manager override for agent performance evaluation
router.put(
  '/evaluations/:evaluationId/override',
  authenticate,
  authorizeRoles('admin'),
  async (req: Request, res: Response) => {
    try {
      const {
        communicationScore,
        resolutionScore,
        knowledgeScore,
        professionalismScore,
        feedbackScore,
        managerNotes
      } = req.body;

      const reviewerName = req.user?.name || req.user?.email || 'Administrator';

      const updated = await agentEvaluationService.overrideEvaluation(req.params.evaluationId, {
        communicationScore: typeof communicationScore === 'number' ? communicationScore : undefined,
        resolutionScore: typeof resolutionScore === 'number' ? resolutionScore : undefined,
        knowledgeScore: typeof knowledgeScore === 'number' ? knowledgeScore : undefined,
        professionalismScore: typeof professionalismScore === 'number' ? professionalismScore : undefined,
        feedbackScore: typeof feedbackScore === 'number' ? feedbackScore : undefined,
        managerNotes,
        reviewedBy: reviewerName
      });

      return res.json({ success: true, evaluation: updated });
    } catch (err: any) {
      console.error('[RecordingsRoute] Error overriding evaluation:', err);
      return res.status(500).json({ error: err.message || 'Failed to override evaluation' });
    }
  }
);

export default router;
