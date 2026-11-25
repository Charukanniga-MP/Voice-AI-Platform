import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });
dotenv.config({ override: true });

import WebSocket from 'ws';
import { sttService } from '../services/stt/stt.service.js';
import { DeepgramSttProvider } from '../services/stt/deepgram.provider.js';

async function testDeepgramLive() {
  console.log('================================================================');
  console.log('       LIVE DEEPGRAM STREAMING STT CONNECTIVITY TEST');
  console.log('================================================================\n');

  const provider = new DeepgramSttProvider();
  const apiKey = provider.getApiKey();

  if (!provider.isConfigured()) {
    console.error('FAIL: DEEPGRAM_API_KEY is not configured or too short.');
    process.exit(1);
  }

  console.log(`1. API Key configured: YES (Key length: ${apiKey.length} chars, masked: ${apiKey.slice(0, 4)}...${apiKey.slice(-4)})`);

  // Step 2: Test REST endpoint authentication
  console.log('\n2. Testing REST Authentication against https://api.deepgram.com/v1/projects...');
  try {
    const res = await fetch('https://api.deepgram.com/v1/projects', {
      headers: {
        Authorization: `Token ${apiKey}`
      }
    });

    if (res.status === 200) {
      const data = await res.json();
      console.log('   REST Authentication: SUCCESS (HTTP 200 OK)');
      console.log(`   Projects found: ${data.projects?.length || 0}`);
    } else {
      console.error(`   REST Authentication FAILED: HTTP ${res.status} - ${res.statusText}`);
      const errText = await res.text();
      console.error('   Details:', errText);
    }
  } catch (err: any) {
    console.error('   REST connection error:', err?.message || err);
  }

  // Step 3: Test live WebSocket streaming connection
  console.log('\n3. Testing Streaming WebSocket: wss://api.deepgram.com/v1/listen...');
  const testLanguages = ['en-IN', 'hi'];

  for (const lang of testLanguages) {
    console.log(`\n   --> Testing language stream: ${lang}...`);
    await new Promise<void>((resolve, reject) => {
      const params = new URLSearchParams({
        model: 'nova-2',
        language: lang,
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
        smart_format: 'true',
        interim_results: 'true'
      });

      const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
      const ws = new WebSocket(url, {
        headers: {
          Authorization: `Token ${apiKey}`
        }
      });

      let connected = false;
      const timeout = setTimeout(() => {
        if (!connected) {
          ws.terminate();
          console.error(`   [FAIL] Timeout connecting to Deepgram WebSocket for ${lang}`);
          resolve();
        }
      }, 7000);

      ws.on('open', () => {
        connected = true;
        clearTimeout(timeout);
        console.log(`   [PASS] WebSocket successfully opened for language: ${lang}`);

        // Send a silent 16kHz PCM audio buffer to test protocol handshake
        const silentPcm = new Int16Array(1600).buffer;
        ws.send(silentPcm);

        // Send close frame
        setTimeout(() => {
          try {
            ws.send(JSON.stringify({ type: 'CloseStream' }));
          } catch {}
          ws.close();
        }, 1200);
      });

      ws.on('message', (msg) => {
        try {
          const parsed = JSON.parse(msg.toString());
          console.log(`   [RECV] Deepgram event: ${parsed.type || 'transcript'}`);
        } catch {
          console.log('   [RECV] Raw frame from Deepgram');
        }
      });

      ws.on('close', (code, reason) => {
        console.log(`   [CLOSE] Deepgram WebSocket closed (code: ${code}, reason: ${reason || 'normal'})`);
        resolve();
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        console.error(`   [ERROR] Deepgram WebSocket error for ${lang}:`, err.message);
        resolve();
      });
    });
  }

  // Step 4: Verify STT Service provider status
  console.log('\n4. Verifying STT Service Provider Activation:');
  const activeProvider = sttService.getActiveProviderName();
  console.log(`   Active Provider: ${activeProvider}`);
  console.log(`   Cloud STT Configured: ${sttService.isCloudSttConfigured()}`);

  console.log('\n================================================================');
  console.log('               LIVE DEEPGRAM TEST COMPLETE');
  console.log('================================================================');
}

testDeepgramLive().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
