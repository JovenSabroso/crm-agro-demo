// Generado: 25/11/2026 05:55
// Entiende qué quiere el cliente. Primero palabras clave (gratis y al instante); si no alcanzan, Gemini.
// La IA SOLO puede devolver una etiqueta de la lista: no redacta nada que se envíe al cliente.

export const INTENTS = ['precios', 'info', 'pedido', 'humano', 'otro'];

// El orden importa: lo más específico primero ("cuánto cuesta el envío" es precios, no pedido).
const KEYWORDS = [
  ['humano', ['persona', 'asesor', 'humano', 'operador', 'hablar con alguien', 'encargado']],
  ['precios', ['precio', 'costo', 'cuanto', 'tarifa', 'cuesta', 'cobran', 'valor']],
  ['info', ['horario', 'atienden', 'abren', 'abierto', 'direccion', 'ubicacion', 'donde', 'telefono', 'como llego']],
  ['pedido', ['pedido', 'comprar', 'quiero', 'reservar', 'agendar', 'encargar', 'ordenar']],
];

/** minúsculas y sin tildes: "Dirección" -> "direccion" */
export function normalizar(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function porPalabrasClave(texto) {
  const n = normalizar(texto);
  for (const [intent, palabras] of KEYWORDS) {
    if (palabras.some((p) => n.includes(p))) return intent;
  }
  return null;
}

export function createClassifier({ gemini, nombreNegocio = 'un negocio' }) {
  const sistema =
    `Eres el clasificador de mensajes de WhatsApp de ${nombreNegocio}. Elige la intención del cliente: ` +
    'precios (costos de productos o servicios), info (horarios, dirección, teléfono), pedido (quiere comprar o reservar algo), ' +
    'humano (quiere hablar con una persona) u otro.';

  return async function clasificar(texto) {
    const rapido = porPalabrasClave(texto);
    if (rapido) return rapido;
    if (!gemini?.activo()) return 'otro';
    return (await gemini.clasificar({ sistema, texto, etiquetas: INTENTS })) ?? 'otro';
  };
}
