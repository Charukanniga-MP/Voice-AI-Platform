import { Router, Request, Response } from 'express';
import { translationService, SUPPORTED_LANGUAGES } from '../services/translation.js';
import { ttsService } from '../services/tts/tts.service.js';

const router = Router();

// 1. High-fidelity Speech Synthesis Audio Stream (MP3) - Powered by ElevenLabs with automated fallback
router.all('/tts', async (req: Request, res: Response) => {
  try {
    const text = ((req.query.text as string) || (req.body?.text as string) || '').trim();
    const rawLang = ((req.query.lang as string) || (req.body?.language as string) || (req.body?.lang as string) || 'en').toLowerCase().slice(0, 2);
    const lang = SUPPORTED_LANGUAGES[rawLang] ? rawLang : 'en';

    if (!text) {
      res.status(400).send('Query parameter "text" is required.');
      return;
    }

    if (text.length > 2500) {
      res.status(400).send('Text exceeds maximum allowable length of 2500 characters.');
      return;
    }

    const { buffer, provider, cached } = await ttsService.synthesize(text, lang);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('X-TTS-Provider', provider);
    res.setHeader('X-TTS-Cached', cached ? 'true' : 'false');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err: any) {
    console.error('[VoiceTTS] Error serving speech audio:', err.message);
    res.status(500).json({ error: 'Failed to generate voice audio stream.' });
  }
});

// 1b. Text-to-Speech Provider Health & Configuration Status
router.get('/status', (req: Request, res: Response) => {
  res.json(ttsService.getStatus());
});

// 2. Multilingual translation endpoint
router.post('/translate', async (req: Request, res: Response) => {
  try {
    const { text, targetLang, sourceLang } = req.body;
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Text is required.' });
      return;
    }

    if (text.length > 5000) {
      res.status(400).json({ error: 'Text exceeds maximum allowable length of 5000 characters.' });
      return;
    }

    const translated = await translationService.translateText(text, targetLang || 'en', sourceLang);
    res.json({
      success: true,
      originalText: text,
      translatedText: translated,
      targetLang: targetLang || 'en'
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Translation failed.' });
  }
});

// 3. Supported Languages Metadata
router.get('/languages', (req: Request, res: Response) => {
  res.json({
    languages: Object.entries(SUPPORTED_LANGUAGES).map(([code, meta]) => ({
      code,
      name: meta.name,
      nativeName: meta.nativeName,
      bcp47: meta.bcp47
    }))
  });
});

export default router;
