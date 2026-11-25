// Generado: 25/11/2026 07:45
// Ejemplo de uso del módulo como programa independiente (`npm start`).
// En el backend de tu compañero NO se usa este archivo: ahí se importa crearModuloWhatsApp (ver src/index.js).
import fs from 'node:fs';
import express from 'express';
import pino from 'pino';
import { crearModuloWhatsApp, loadConfig, validateConfig } from './index.js';

try { process.loadEnvFile('.env'); } catch { /* sin .env: se usa el entorno del proceso */ }

const config = loadConfig();
const problemas = validateConfig(config);
if (problemas.length) {
  console.error(`Configuración inválida:\n - ${problemas.join('\n - ')}`);
  process.exit(1);
}

const logger = pino({ level: config.logLevel });
const negocio = JSON.parse(fs.readFileSync(config.negocioFile, 'utf8'));

const wa = crearModuloWhatsApp({ config, logger, negocio });

const app = express();
app.disable('x-powered-by');
app.use('/api/whatsapp', wa.router);

const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port }, 'Bot de WhatsApp listo. Panel: /api/whatsapp/panel');
  wa.iniciar();
});

async function apagar(signal) {
  logger.info({ signal }, 'Cerrando');
  await wa.detener();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => apagar('SIGINT'));
process.on('SIGTERM', () => apagar('SIGTERM'));
// Un fallo inesperado no deja un proceso a medias: se registra y PM2 lo reinicia.
process.on('uncaughtException', (err) => { logger.fatal({ err: err.message }, 'Excepción no controlada'); process.exit(1); });
process.on('unhandledRejection', (err) => logger.error({ err: String(err) }, 'Promesa rechazada sin manejar'));
