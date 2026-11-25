// Generado: 25/11/2026 05:45
// Lee el entorno (.env o variables del proceso) y valida lo imprescindible.
import path from 'node:path';

const num = (v, def) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : def);
const lista = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export function loadConfig(env = process.env) {
  const storageDir = path.resolve(env.STORAGE_DIR || './storage');
  return {
    host: env.HOST || '127.0.0.1',
    port: num(env.PORT, 3101),
    adminToken: env.ADMIN_TOKEN || '',
    logLevel: env.LOG_LEVEL || 'info',

    gemini: {
      keys: lista(env.GEMINI_API_KEY),
      model: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
      fallbackModels: lista(env.GEMINI_MODELOS_RESPALDO ?? 'gemini-3.1-flash-lite,gemini-3.5-flash'),
      timeoutMs: num(env.GEMINI_TIMEOUT_MS, 8000),
      totalBudgetMs: num(env.GEMINI_BUDGET_MS, 20000),
      mode: env.MODO_IA === 'responder' ? 'responder' : 'clasificar',
    },

    wa: {
      replyDelayMinMs: num(env.REPLY_DELAY_MIN_MS, 4000),
      replyDelayMaxMs: num(env.REPLY_DELAY_MAX_MS, 9000),
      batchWindowMs: num(env.BATCH_WINDOW_MS, 5000),
      batchMaxWaitMs: num(env.BATCH_MAX_WAIT_MS, 30000),
      maxSendsPerMinute: num(env.MAX_SENDS_PER_MINUTE, 20),
      maxReconnectAttempts: num(env.MAX_RECONNECT_ATTEMPTS, 8),
      optoutKeywords: lista(env.OPTOUT_KEYWORDS ?? 'baja,stop,no quiero recibir mensajes').map((s) => s.toLowerCase()),
    },

    bot: {
      sessionMinutes: num(env.SESSION_MINUTES, 30),
      humanPauseHours: num(env.HUMAN_PAUSE_HOURS, 8),
    },

    storageDir,
    authDir: path.join(storageDir, 'auth'),
    stateFile: path.join(storageDir, 'estado.json'),
    negocioFile: path.resolve(env.NEGOCIO_FILE || './datos/negocio.json'),
  };
}

/** Devuelve la lista de problemas; vacía si todo está bien. */
export function validateConfig(config) {
  const problems = [];
  if (config.adminToken.length < 24) problems.push('ADMIN_TOKEN debe tener al menos 24 caracteres (openssl rand -hex 32)');
  if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
    problems.push('HOST debe ser 127.0.0.1: el servicio no debe quedar expuesto; publícalo con nginx + HTTPS');
  }
  return problems;
}
