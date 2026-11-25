import { createApi } from '../core/api.js';
import { z } from '../core/schemas.js';
import { db } from '../db/index.js';
import { config } from '../config/env.js';
import { whatsappWebhookGet, whatsappWebhookPost } from './whatsapp/webhook.controller.js';
import { confirmar, rechazar } from './ai/confirmation.service.js';
import { Page } from '../core/api.js';
import { audit } from '../core/audit.js';

export const integraciones = createApi('Integraciones (reservadas)', { prefix: '/integraciones' });

integraciones.get('/estado', { summary: 'Estado de las integraciones futuras (todas desactivadas en esta fase)', perm: 'finca:admin', module: 'M0' }, () => ({
  whatsapp: { estado: 'pendiente_de_integracion', habilitada: config.integrations.whatsapp.enabled, proveedor: config.integrations.whatsapp.provider, webhook: '/api/integraciones/whatsapp/webhook', webhook_activo: false, credenciales_configuradas: !!config.integrations.whatsapp.accessToken },
  ia: { estado: 'pendiente_de_integracion', habilitada: config.integrations.ai.enabled, proveedor: config.integrations.ai.provider, credenciales_configuradas: !!config.integrations.ai.apiKey },
  despliegue: { estado: 'pendiente', detalle: 'Render/Vercel/dominio no configurados; ver README' },
}));

// Webhooks reservados: responden 503 mientras la integración esté desactivada.
integraciones.router.get('/whatsapp/webhook', whatsappWebhookGet);
integraciones.router.post('/whatsapp/webhook', whatsappWebhookPost);

integraciones.get('/eventos', { summary: 'Registro de eventos de integración', perm: 'finca:admin', module: 'M0' }, (req) => {
  const rows = db.prepare('SELECT id, canal, direccion, proveedor, tipo, estado, error, created_at FROM integracion_eventos WHERE finca_id=? OR finca_id IS NULL ORDER BY id DESC LIMIT 100').all(req.user.fincaId);
  return new Page(rows, { page: 1, pageSize: 100, total: rows.length });
});

// Cola de confirmación (infraestructura interna lista para cuando existan propuestas de IA/WhatsApp)
integraciones.get('/acciones-pendientes', { summary: 'Propuestas pendientes de confirmación humana', perm: 'campo:write', module: 'M1' }, (req) =>
  db.prepare("SELECT id, origen, tipo, payload, estado, created_at FROM acciones_pendientes WHERE finca_id=? ORDER BY id DESC LIMIT 100").all(req.user.fincaId).map(a => ({ ...a, payload: JSON.parse(a.payload) })));
integraciones.post('/acciones-pendientes/:id/confirmar', { summary: 'Confirmar una propuesta y ejecutar el registro', perm: 'campo:write', module: 'M1', status: 200 }, async (req) => {
  const r = await confirmar(Number(req.params.id), req.user.fincaId);
  audit(req, { accion: 'confirmar_accion_pendiente', entidad: 'acciones_pendientes', id: req.params.id });
  return r;
});
integraciones.post('/acciones-pendientes/:id/rechazar', { summary: 'Rechazar una propuesta', perm: 'campo:write', module: 'M1', status: 200 }, (req) => rechazar(Number(req.params.id), req.user.fincaId));
