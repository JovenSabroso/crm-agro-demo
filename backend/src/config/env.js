import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = process.env;
const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

if (isProd && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET (>= 32 caracteres) es obligatorio en produccion');
}

export const config = {
  env: env.NODE_ENV || 'development',
  isProd, isTest,
  port: Number(env.PORT || 4000),
  dbPath: env.DB_PATH || path.join(root, 'data', 'crm-agro.db'),
  // Solo para desarrollo local: en produccion JWT_SECRET es obligatorio.
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me-dev-only-secret-change-me',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '8h',
  bcryptRounds: isTest ? 4 : Number(env.BCRYPT_ROUNDS || 12),
  corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(s => s.trim()).filter(Boolean),
  publicBaseUrl: (env.PUBLIC_BASE_URL || 'http://localhost:5173').replace(/\/$/, ''), // base para URLs de QR
  allowRegistration: (env.ALLOW_REGISTRATION ?? 'true') === 'true',
  exposeResetToken: !isProd && (env.EXPOSE_RESET_TOKEN ?? 'true') === 'true', // solo desarrollo
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: isTest ? 100000 : Number(env.RATE_LIMIT_MAX || 600),
    loginMax: isTest ? 100000 : Number(env.LOGIN_RATE_LIMIT_MAX || 20),
  },
  // Integraciones futuras: SIEMPRE desactivadas en esta fase (enabled no se lee de .env a proposito).
  integrations: {
    whatsapp: {
      enabled: false,
      provider: env.WHATSAPP_PROVIDER || 'cloud-api',
      verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
      accessToken: env.WHATSAPP_ACCESS_TOKEN || '',
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
      appSecret: env.WHATSAPP_APP_SECRET || '',
      twilioSid: env.TWILIO_ACCOUNT_SID || '',
      twilioToken: env.TWILIO_AUTH_TOKEN || '',
    },
    ai: { enabled: false, provider: env.AI_PROVIDER || 'anthropic', apiKey: env.AI_API_KEY || '', model: env.AI_MODEL || '' },
  },
};
