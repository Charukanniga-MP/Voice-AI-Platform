import { Router, Request, Response } from 'express';
import { translationService, SUPPORTED_LANGUAGES } from '../services/translation.js';

const router = Router();

// In-memory cache for generated TTS audio to ensure ultra-low latency (<10ms for cached answers)
const ttsCache = new Map<string, Buffer>();
const MAX_CACHE_ENTRIES = 300;

function splitIntoChunks(text: string, maxChunkLength = 160): string[] {
  const clean = text.replace(/[\r\n]+/g, ' ').trim();
  if (clean.length <= maxChunkLength) return [clean];

  // Split on sentence boundaries (., !, ?, ।, ;, ,)
  const sentenceRegex = /[^.!?।;]+[.!?।;]+|[^.!?।;]+$/g;
  const rawSentences = clean.match(sentenceRegex) || [clean];

  const chunks: string[] = [];
  let current = '';

  for (const sentence of rawSentences) {
    const s = sentence.trim();
    if (!s) continue;

    if ((current + ' ' + s).trim().length <= maxChunkLength) {
      current = (current + ' ' + s).trim();
    } else {
      if (current) chunks.push(current);
      if (s.length <= maxChunkLength) {
        current = s;
      } else {
        // Subdivide very long sentences by comma or space
        const words = s.split(' ');
        let sub = '';
        for (const w of words) {
          if ((sub + ' ' + w).trim().length <= maxChunkLength) {
            sub = (sub + ' ' + w).trim();
          } else {
            if (sub) chunks.push(sub);
            sub = w;
          }
        }
        if (sub) current = sub;
        else current = '';
      }
    }
  }

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [clean.slice(0, maxChunkLength)];
}

// 1. High-fidelity Speech Synthesis Audio Stream (MP3)
router.get('/tts', async (req: Request, res: Response) => {
  try {
    const text = ((req.query.text as string) || '').trim();
    const rawLang = ((req.query.lang as string) || 'en').toLowerCase().slice(0, 2);
    const lang = SUPPORTED_LANGUAGES[rawLang] ? rawLang : 'en';

    if (!text) {
      res.status(400).send('Query parameter "text" is required.');
      return;
    }

    const cacheKey = `${lang}:${text}`;
    if (ttsCache.has(cacheKey)) {
      const cached = ttsCache.get(cacheKey)!;
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', cached.length);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(cached);
      return;
    }

    const chunks = splitIntoChunks(text);
    const buffers: Buffer[] = [];

    for (const chunk of chunks) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
      const audioRes = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!audioRes.ok) {
        throw new Error(`TTS upstream error: HTTP ${audioRes.status}`);
      }

      const arrBuf = await audioRes.arrayBuffer();
      buffers.push(Buffer.from(arrBuf));
    }

    const combined = Buffer.concat(buffers);

    // Save in cache
    if (ttsCache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = ttsCache.keys().next().value;
      if (firstKey) ttsCache.delete(firstKey);
    }
    ttsCache.set(cacheKey, combined);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', combined.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(combined);
  } catch (err: any) {
    console.error('[VoiceTTS] Error serving speech audio:', err.message);
    res.status(500).json({ error: 'Failed to generate voice audio stream.' });
  }
});

// 2. Multilingual translation endpoint
router.post('/translate', async (req: Request, res: Response) => {
  try {
    const { text, targetLang, sourceLang } = req.body;
    if (!text) {
      res.status(400).json({ error: 'Text is required.' });
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
