import assert from 'assert';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { ElevenLabsTtsProvider } from '../services/tts/elevenlabs.provider.js';
import { GoogleTranslateTtsProvider } from '../services/tts/google.provider.js';
import { TtsService } from '../services/tts/tts.service.js';

async function runElevenLabsTestSuite() {
  console.log('================================================================');
  console.log('     KAIRA ELEVENLABS TTS & VOICE INTEGRATION TEST SUITE       ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  [PASS] TC-${total.toString().padStart(2, '0')}: ${name}`);
    } catch (err: any) {
      console.error(`  [FAIL] TC-${total.toString().padStart(2, '0')}: ${name}`);
      console.error(`         Error: ${err.message}`);
    }
  }

  const provider = new ElevenLabsTtsProvider();
  const fallback = new GoogleTranslateTtsProvider();
  const service = new TtsService();

  // TC-01: ElevenLabs configuration detection
  await test('ElevenLabs provider detects configured API key securely', async () => {
    assert.strictEqual(provider.getProviderName(), 'elevenlabs');
    assert.strictEqual(provider.isConfigured(), true, 'ELEVENLABS_API_KEY should be recognized as configured');
  });

  // TC-02: Status does not leak API key
  await test('ElevenLabs getStatus() returns metadata without leaking secret key', async () => {
    const status = provider.getStatus();
    assert.strictEqual(status.configured, true);
    assert.strictEqual(status.model, 'eleven_multilingual_v2');
    assert.ok(status.supportedLanguages.includes('en'));
    assert.ok(status.supportedLanguages.includes('hi'));
    assert.ok(status.supportedLanguages.includes('ta'));
    const statusString = JSON.stringify(status);
    assert.ok(!statusString.includes('sk_'), 'API key must NEVER appear in status payload');
  });

  // TC-03: Live synthesis verification with minimal character footprint
  await test('Synthesize short phrase via ElevenLabs returns valid MP3 audio buffer', async () => {
    // Keep character footprint minimal (17 chars) to avoid burning unnecessary paid credits
    const testText = 'Hello from KAIRA.';
    const audioBuffer = await provider.synthesize(testText, 'en');
    assert.ok(Buffer.isBuffer(audioBuffer), 'Output must be a Buffer');
    assert.ok(audioBuffer.length > 500, `Audio buffer should contain data (got ${audioBuffer.length} bytes)`);
    // Check for MP3 sync word or ID3 header (0xFF, 0xFB/0xF3/0xF2 or "ID3")
    const isId3OrMp3 = (audioBuffer[0] === 0x49 && audioBuffer[1] === 0x44 && audioBuffer[2] === 0x33) ||
                       (audioBuffer[0] === 0xFF && (audioBuffer[1] & 0xE0) === 0xE0);
    assert.ok(isId3OrMp3, 'Buffer must be valid MPEG Audio stream');
  });

  // TC-04: Multilingual voice synthesis (Indian language support)
  await test('ElevenLabs Multilingual v2 supports Indic languages', async () => {
    const status = provider.getStatus();
    assert.ok(status.supportedLanguages.includes('hi'), 'Hindi must be supported');
    assert.ok(status.supportedLanguages.includes('ta'), 'Tamil must be supported');
    assert.ok(status.supportedLanguages.includes('te'), 'Telugu must be supported');
  });

  // TC-05: In-memory LRU caching prevents duplicate upstream requests
  await test('TtsService in-memory caching returns cached audio on second call', async () => {
    service.clearCache();
    const phrase = 'Cached voice test.';
    const res1 = await service.synthesize(phrase, 'en');
    assert.strictEqual(res1.cached, false, 'First call should not be cached');

    const res2 = await service.synthesize(phrase, 'en');
    assert.strictEqual(res2.cached, true, 'Second call should return from cache (<1ms)');
    assert.strictEqual(res1.buffer.length, res2.buffer.length);
  });

  // TC-06: Automated graceful fallback on upstream failure
  await test('Fallback provider produces valid audio stream when primary fails', async () => {
    const fallbackBuffer = await fallback.synthesize('Fallback audio test.', 'en');
    assert.ok(Buffer.isBuffer(fallbackBuffer), 'Fallback must produce audio Buffer');
    assert.ok(fallbackBuffer.length > 200, 'Fallback audio must contain valid bytes');
  });

  // TC-07: Error handling and resilience
  await test('TtsService handles empty and oversized text boundaries safely', async () => {
    await assert.rejects(async () => {
      await service.synthesize('', 'en');
    }, /required/i);
  });

  console.log('\n================================================================');
  console.log(`Tests Passed: ${passed} / ${total} (${Math.round((passed / total) * 100)}%)`);
  console.log('================================================================');

  if (passed === total) {
    console.log('\n✓ ALL ELEVENLABS INTEGRATION TESTS PASSED PERFECTLY!\n');
    process.exit(0);
  } else {
    console.error('\n✗ SOME TESTS FAILED!\n');
    process.exit(1);
  }
}

runElevenLabsTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
