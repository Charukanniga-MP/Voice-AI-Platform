import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function listVoices() {
  const key = process.env.ELEVENLABS_API_KEY;
  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': key || '' }
  });
  const data = await res.json();
  if (data.voices) {
    console.log(`Total voices available: ${data.voices.length}`);
    for (const v of data.voices) {
      console.log(`VOICE: id="${v.voice_id}" name="${v.name}" category="${v.category}"`);
    }
  } else {
    console.log('API Response:', data);
  }
}

listVoices().catch(console.error);
