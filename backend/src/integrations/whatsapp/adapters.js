import { MessagingProvider } from './provider.interface.js';
import { IntegrationDisabledError } from '../errors.js';

/**
 * ADAPTADORES RESERVADOS. Ninguno realiza llamadas de red en esta fase.
 * Para conectarlos: implementar los métodos marcados "TODO(integración)" siguiendo docs/INTEGRACIONES.md.
 */
export class WhatsAppCloudApiAdapter extends MessagingProvider {
  constructor(cfg) { super(); this.cfg = cfg; }
  get name() { return 'whatsapp-cloud-api'; }
  verifyWebhook() { throw new IntegrationDisabledError('whatsapp'); }              // TODO(integración): comparar hub.verify_token y devolver hub.challenge
  validateSignature() { throw new IntegrationDisabledError('whatsapp'); }          // TODO(integración): HMAC-SHA256 de X-Hub-Signature-256 con APP_SECRET
  parseInbound() { throw new IntegrationDisabledError('whatsapp'); }              // TODO(integración): entry[].changes[].value.messages[] → InboundMessage[]
  async send() { throw new IntegrationDisabledError('whatsapp'); }                // TODO(integración): POST /{phone-number-id}/messages
}

export class TwilioWhatsAppAdapter extends MessagingProvider {
  constructor(cfg) { super(); this.cfg = cfg; }
  get name() { return 'twilio-whatsapp'; }
  verifyWebhook() { throw new IntegrationDisabledError('whatsapp'); }
  validateSignature() { throw new IntegrationDisabledError('whatsapp'); }          // TODO(integración): validar X-Twilio-Signature
  parseInbound() { throw new IntegrationDisabledError('whatsapp'); }
  async send() { throw new IntegrationDisabledError('whatsapp'); }
}

export function createMessagingProvider(cfg) {
  return cfg.provider === 'twilio' ? new TwilioWhatsAppAdapter(cfg) : new WhatsAppCloudApiAdapter(cfg);
}
