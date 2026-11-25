import { config } from '../../config/env.js';
import { AiInput, AiOutput } from './schemas.js';
import { systemPrompt } from './prompts.js';
import { herramientas } from './tools.js';
import { createAiProvider } from './providers.js';
import { proponer } from './confirmation.service.js';
import { registrarEvento } from '../whatsapp/messaging.service.js';

// Texto que invalida una respuesta de la IA: cualquier mención de dosis calculadas/recomendadas.
const PATRON_DOSIS = /\b\d+([.,]\d+)?\s*(ml|cc|l|lt|litros?|g|gr|kg)\s*(\/|por)\s*(ha|hect[aá]rea|litro|l|lt|bomba|mochila)\b/i;

/**
 * Interpreta un mensaje del encargado y lo convierte en una PROPUESTA pendiente de confirmación.
 * Con la IA desactivada (fase actual) devuelve { disponible:false } sin llamar a ningún proveedor y sin guardar nada.
 */
export async function interpretar(input, cfg = config.integrations.ai) {
  const data = AiInput.parse(input);
  if (!cfg.enabled) return { disponible: false, motivo: 'integracion_desactivada' };
  const provider = createAiProvider(cfg);
  const contexto = herramientas.contextoFinca(data.fincaId);
  let bruto;
  try { bruto = await provider.complete({ system: systemPrompt(contexto), user: data.texto }); }
  catch (e) { registrarEvento({ fincaId: data.fincaId, canal: 'ia', direccion: 'saliente', proveedor: provider.name, tipo: 'interpretar', estado: 'error', error: e.message }); throw e; }
  const salida = validarSalida(bruto);
  if (salida.intencion && salida.intencion.tipo !== 'consulta') {
    const accion = proponer({ fincaId: data.fincaId, usuarioId: data.usuarioId ?? null, origen: `ia:${provider.name}`, tipo: salida.intencion.tipo, payload: salida.intencion });
    return { disponible: true, respuesta: `${salida.respuesta}\nResponde CONFIRMAR para guardar o CANCELAR para descartar.`, accionPendienteId: accion.id, requiereConfirmacion: true };
  }
  return { disponible: true, respuesta: salida.respuesta, requiereConfirmacion: false };
}

/** Valida estructura y contenido de la respuesta del modelo. Lanza si es inválida o contiene dosis. */
export function validarSalida(texto) {
  let json; try { json = JSON.parse(texto); } catch { throw new Error('La respuesta del modelo no es JSON válido'); }
  const out = AiOutput.parse(json);
  if (PATRON_DOSIS.test(out.respuesta)) throw new Error('Respuesta rechazada: contiene una dosis de agroquímico, algo que el sistema no puede recomendar');
  if (out.intencion && out.intencion.tipo !== 'consulta' && !out.requiereConfirmacion) throw new Error('Respuesta rechazada: toda creación de registros debe requerir confirmación');
  return out;
}
