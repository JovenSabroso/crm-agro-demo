import { z } from 'zod';

/**
 * Contrato de proveedores de mensajería (WhatsApp Cloud API, Twilio, etc.).
 * Todo adaptador debe extender MessagingProvider e implementar sus métodos.
 */
export const InboundMessage = z.object({
  proveedor: z.string(),
  idExterno: z.string(),                 // id del mensaje en el proveedor (idempotencia)
  desde: z.string(),                     // teléfono E.164 del remitente
  texto: z.string().max(4000),
  recibidoEn: z.string(),                // ISO-8601
  tipo: z.enum(['texto', 'audio', 'imagen', 'otro']).default('texto'),
});

export const OutboundMessage = z.object({
  para: z.string(),
  texto: z.string().max(4000),
  plantilla: z.string().optional(),      // plantilla aprobada (necesaria fuera de la ventana de 24h en Cloud API)
  contexto: z.record(z.string(), z.any()).optional(),
});

export class MessagingProvider {
  /** @returns {string} nombre del proveedor */
  get name() { throw new Error('No implementado'); }
  /** Verificación inicial del webhook (GET). @returns {string|null} challenge a responder */
  verifyWebhook(_query) { throw new Error('No implementado'); }
  /** Valida la firma del webhook (HMAC) sobre el cuerpo crudo. @returns {boolean} */
  validateSignature(_rawBody, _headers) { throw new Error('No implementado'); }
  /** Convierte el payload del proveedor en mensajes normalizados (InboundMessage[]). */
  parseInbound(_payload) { throw new Error('No implementado'); }
  /** Envía un mensaje. @returns {Promise<{idExterno:string}>} */
  async send(_outboundMessage) { throw new Error('No implementado'); }
}
