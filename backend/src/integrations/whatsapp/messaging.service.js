import { db } from '../../db/index.js';
import { config } from '../../config/env.js';
import { createMessagingProvider } from './adapters.js';
import { OutboundMessage } from './provider.interface.js';

/**
 * Servicio de mensajería desacoplado del proveedor.
 * Mientras config.integrations.whatsapp.enabled sea false NO se envía nada: se devuelve un resultado explícito
 * { enviado:false } y se registra el intento en integracion_eventos (estado "desactivado").
 * Los módulos internos (alertas) podrán llamar a notificar() sin cambios cuando se active el canal.
 */
export function registrarEvento({ fincaId = null, canal = 'whatsapp', direccion, proveedor, tipo, payload, estado = 'recibido', error = null }) {
  return db.prepare('INSERT INTO integracion_eventos (finca_id, canal, direccion, proveedor, tipo, payload, estado, error) VALUES (?,?,?,?,?,?,?,?)')
    .run(fincaId, canal, direccion, proveedor ?? null, tipo ?? null, payload ? JSON.stringify(payload).slice(0, 8000) : null, estado, error).lastInsertRowid;
}

export async function notificar(fincaId, mensaje, cfg = config.integrations.whatsapp) {
  const msg = OutboundMessage.parse(mensaje);
  const provider = createMessagingProvider(cfg);
  if (!cfg.enabled) {
    registrarEvento({ fincaId, direccion: 'saliente', proveedor: provider.name, tipo: 'notificacion', payload: { para: msg.para }, estado: 'desactivado' });
    return { enviado: false, motivo: 'integracion_desactivada' };
  }
  try { const r = await provider.send(msg); registrarEvento({ fincaId, direccion: 'saliente', proveedor: provider.name, tipo: 'notificacion', payload: { para: msg.para }, estado: 'enviado' }); return { enviado: true, ...r }; }
  catch (e) { registrarEvento({ fincaId, direccion: 'saliente', proveedor: provider.name, tipo: 'notificacion', payload: { para: msg.para }, estado: 'error', error: e.message }); throw e; }
}
