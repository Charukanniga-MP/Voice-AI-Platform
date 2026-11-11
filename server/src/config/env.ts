import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

export interface EnvConfig {
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  FRONTEND_URL: string;
  BACKEND_URL: string;
  GOOGLE_CLIENT_ID: string | null;
  GOOGLE_CLIENT_SECRET: string | null;
  GOOGLE_REDIRECT_URI: string;
  EMAIL_HOST?: string;
  EMAIL_PORT?: number;
  EMAIL_USER?: string;
  EMAIL_PASSWORD?: string;
  EMAIL_FROM?: string;
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX: number;
}

export function validateEnv(): EnvConfig {
  const isProd = process.env.NODE_ENV === 'production';
  const port = parseInt(process.env.PORT || '5000', 10);

  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    if (isProd) {
      console.error('FATAL CONFIGURATION ERROR: Mandatory environment variable JWT_SECRET is not set.');
      process.exit(1);
    } else {
      console.warn('⚠️ [Config Warning] JWT_SECRET is using fallback development secret. Set a strong secret in .env for production.');
    }
  }

  const finalJwtSecret = jwtSecret || 'kaira-production-secret-voice-key-2025';
  if (isProd && finalJwtSecret === 'kaira-production-secret-voice-key-2025') {
    console.error('FATAL CONFIGURATION ERROR: Default development JWT_SECRET cannot be used in production.');
    process.exit(1);
  }

  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const backendUrl = (process.env.BACKEND_URL || `http://localhost:${port}`).replace(/\/$/, '');

  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || null;
  const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${backendUrl}/api/auth/google/callback`;

  return {
    PORT: port,
    NODE_ENV: (process.env.NODE_ENV as any) || 'development',
    JWT_SECRET: finalJwtSecret,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '2h',
    FRONTEND_URL: frontendUrl,
    BACKEND_URL: backendUrl,
    GOOGLE_CLIENT_ID: googleClientId,
    GOOGLE_CLIENT_SECRET: googleClientSecret,
    GOOGLE_REDIRECT_URI: googleRedirectUri,
    EMAIL_HOST: process.env.EMAIL_HOST?.trim(),
    EMAIL_PORT: process.env.EMAIL_PORT ? parseInt(process.env.EMAIL_PORT, 10) : undefined,
    EMAIL_USER: process.env.EMAIL_USER?.trim(),
    EMAIL_PASSWORD: process.env.EMAIL_PASSWORD?.trim(),
    EMAIL_FROM: process.env.EMAIL_FROM?.trim() || 'KAIRA Support <no-reply@kaira.ai>',
    RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 mins default
    RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '300', 10) // 300 requests / 15 mins
  };
}

export const env = validateEnv();
