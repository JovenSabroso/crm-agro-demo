import { config } from '../../config/env.js';
import { createMessagingProvider } from './adapters.js';
import { IntegrationDisabledError } from '../errors.js';
import { InboundMessage } from './provider.interface.js';
import { registrarEvento } from './messaging.service.js';

/**
 * Punto de conexión RESERVADO para webhooks de WhatsApp. Mientras la integración esté desactivada
 * responde 503 INTEGRATION_DISABLED y no procesa ni guarda ningún contenido.
 *
 * Flujo previsto al activarla (ver docs/INTEGRACIONES.md):
 *  1. GET  → provider.verifyWebhook(query)
 *  2. POST → validar firma sobre el cuerpo crudo → parseInbound → InboundMessage[]
 *  3. Cada mensaje: registrarEvento(entrante) → ia/ai.service.interpretar() → propuesta en acciones_pendientes
 *     → responder pidiendo CONFIRMACIÓN → solo al confirmar se ejecuta el registro.
 */
export function whatsappWebhookGet(req, res, next) {
  try {
    const cfg = config.integrations.whatsapp;
    if (!cfg.enabled) throw new IntegrationDisabledError('whatsapp');
    const challenge = createMessagingProvider(cfg).verifyWebhook(req.query);
    res.status(200).send(challenge);
  } catch (e) { next(e); }
}

export function whatsappWebhookPost(req, res, next) {
  try {
    const cfg = config.integrations.whatsapp;
    if (!cfg.enabled) throw new IntegrationDisabledError('whatsapp');
    const provider = createMessagingProvider(cfg);
    if (!provider.validateSignature(req.rawBody ?? Buffer.from(''), req.headers)) return res.status(401).json({ error: { code: 'BAD_SIGNATURE', message: 'Firma inválida' } });
    const mensajes = provider.parseInbound(req.body).map(m => InboundMessage.parse(m));
    for (const m of mensajes) registrarEvento({ direccion: 'entrante', proveedor: provider.name, tipo: m.tipo, payload: { desde: m.desde, idExterno: m.idExterno } });
    res.sendStatus(200);
  } catch (e) { next(e); }
}
