import { AppError } from '../core/errors.js';

/** Error estándar para integraciones que todavía no están conectadas (fase actual: NO se conecta ningún proveedor externo). */
export class IntegrationDisabledError extends AppError {
  constructor(canal) {
    super(503, `La integración "${canal}" está desactivada: pendiente de conexión (ver backend/src/integrations/README.md)`, 'INTEGRATION_DISABLED');
    this.name = 'IntegrationDisabledError'; this.canal = canal;
  }
}
