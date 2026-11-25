import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { config } from './config/env.js';
import { buildOpenApi } from './core/api.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { db } from './db/index.js';
import { crearWhatsAppCrm } from './whatsapp/integracion.js';

import { api as authApi } from './modules/auth.js';
import { finca, modulos, roles, usuarios, lotes, cultivos, campanas, plantaciones, auditoria } from './modules/nucleo.js';
import { labores, riegos, aplicaciones, cosechas, campo } from './modules/campo.js';
import { trazabilidad, publico } from './modules/trazabilidad.js';
import { trabajadores, tareas, asistencia, jornales, anticipos, pagos } from './modules/trabajadores.js';
import { proveedores, productos, inventario } from './modules/inventario.js';
import { clientes, ventas, cxc, pedidos } from './modules/ventas.js';
import { viveros, especies, siembras } from './modules/vivero.js';
import { finanzas, gastos, ingresos } from './modules/finanzas.js';
import { dashboard } from './modules/dashboard.js';
import { integraciones } from './integrations/index.js';

const frontDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');

export let whatsapp = null;

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({
    origin(origin, cb) { if (!origin || config.corsOrigins.includes(origin)) return cb(null, true); cb(null, false); },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'],
  }));
  if (!config.isTest) app.use(morgan(config.isProd ? 'combined' : 'dev'));
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/api', rateLimit({ windowMs: config.rateLimit.windowMs, limit: config.rateLimit.max, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Demasiadas solicitudes. Intenta más tarde.' } } }));

  app.get('/api/health', (_req, res) => { db.prepare('SELECT 1').get(); res.json({ data: { estado: 'ok', version: '1.0.0', entorno: config.env, hora: new Date().toISOString() } }); });
  app.get('/api/openapi.json', (_req, res) => res.json(buildOpenApi()));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(undefined, { swaggerOptions: { url: '/api/openapi.json' }, customSiteTitle: 'CRM-Agro · API' }));

  for (const a of [authApi, finca, modulos, roles, usuarios, lotes, cultivos, campanas, plantaciones, auditoria, labores, riegos, aplicaciones, cosechas, campo,
    trazabilidad, publico, trabajadores, tareas, asistencia, jornales, anticipos, pagos, proveedores, productos, inventario, clientes, ventas, cxc, pedidos,
    viveros, especies, siembras, finanzas, gastos, ingresos, dashboard, integraciones]) app.use('/api' + (a.prefix || ''), a.router);

  // WhatsApp + Gemini (no se monta en tests). Se conecta en server.js tras app.listen.
  if (!config.isTest) { whatsapp = crearWhatsAppCrm(); app.use('/api/whatsapp', whatsapp.router); }

  app.use('/api', notFoundHandler);
  // Si existe el build del frontend se sirve desde el mismo proceso (ejecución local simple).
  if (fs.existsSync(path.join(frontDist, 'index.html'))) {
    app.use(express.static(frontDist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(frontDist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
