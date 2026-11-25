import { IntegrationDisabledError } from '../errors.js';

/**
 * Contrato de proveedores de IA (Claude, Groq u otro). Un adaptador recibe { system, user } y devuelve TEXTO JSON,
 * que ai.service valida contra AiOutput. NINGÚN adaptador realiza llamadas de red en esta fase.
 */
export class AiProvider {
  get name() { throw new Error('No implementado'); }
  /** @param {{system:string,user:string}} _prompt @returns {Promise<string>} JSON en texto */
  async complete(_prompt) { throw new Error('No implementado'); }
}
export class AnthropicAdapter extends AiProvider {
  constructor(cfg) { super(); this.cfg = cfg; }
  get name() { return 'anthropic'; }
  async complete() { throw new IntegrationDisabledError('ia'); }   // TODO(integración): POST https://api.anthropic.com/v1/messages
}
export class GroqAdapter extends AiProvider {
  constructor(cfg) { super(); this.cfg = cfg; }
  get name() { return 'groq'; }
  async complete() { throw new IntegrationDisabledError('ia'); }   // TODO(integración): POST https://api.groq.com/openai/v1/chat/completions
}
export function createAiProvider(cfg) { return cfg.provider === 'groq' ? new GroqAdapter(cfg) : new AnthropicAdapter(cfg); }
