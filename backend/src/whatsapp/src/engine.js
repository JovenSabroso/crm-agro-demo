// Generado: 25/11/2026 07:30
// Motor del bot: máquina de estados por teléfono. Devuelve UN solo texto por turno.
// Los precios, horarios y direcciones salen SIEMPRE de tus datos (JSON o base de datos), nunca de la IA.
//
// `negocio` puede ser un objeto o una función (incluso async) que se llama en CADA respuesta:
//   negocio: async () => ({ nombre, horario, direccion, telefono, catalogo: await db.productos.findAll(), ... })
// Así los precios siempre están al día y vienen de la base de datos del backend.
import { normalizar } from './intents.js';

const SALUDOS = ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'menu', 'inicio', 'ayuda', 'hi'];
const moneda = (n) => `Bs ${Number(n).toFixed(2).replace('.', ',')}`;

export function createEngine({ negocio, classify, gemini, store, config, hooks = {} }) {
  const leerNegocio = typeof negocio === 'function' ? negocio : async () => negocio;

  const menu = (neg) =>
    `¡Hola! Soy el asistente virtual de *${neg.nombre}*. ${neg.saludo_extra ?? ''}\n\n` +
    '¿En qué te ayudo? Responde con un número:\n\n' +
    '1️⃣ Precios\n2️⃣ Horarios y ubicación\n3️⃣ Hacer un pedido o reserva\n4️⃣ Hablar con una persona';

  const precios = (neg) => {
    const items = (neg.catalogo ?? []).filter((p) => p.precio > 0);
    if (!items.length) return 'Por ahora no tengo la lista de precios a mano. Escribe *4* para hablar con una persona.';
    return `*Precios de ${neg.nombre}*\n\n${items.map((p) => `• ${p.nombre}: ${moneda(p.precio)}`).join('\n')}\n\nEscribe *menu* para volver.`;
  };

  const info = (neg) =>
    `*Horario:* ${neg.horario}\n*Dirección:* ${neg.direccion}\n*Teléfono:* ${neg.telefono}\n\nEscribe *menu* para volver.`;

  const humano = (phone) => {
    store.pausar(phone, config.bot.humanPauseHours);
    return `Listo, una persona del equipo te escribirá lo antes posible. Mientras tanto no te enviaré más mensajes automáticos (${config.bot.humanPauseHours} h).`;
  };

  /** Contexto en texto plano para el modo "responder": todo lo que el negocio permite decir. */
  const contexto = (neg) =>
    [
      `Negocio: ${neg.nombre}`, `Horario: ${neg.horario}`, `Dirección: ${neg.direccion}`, `Teléfono: ${neg.telefono}`,
      ...(neg.catalogo ?? []).map((p) => `Producto: ${p.nombre}; precio: ${p.precio > 0 ? moneda(p.precio) : 'consultar'}; ${p.detalle ?? ''}`),
      ...(neg.preguntas_frecuentes ?? []).map((f) => `Pregunta: ${f.pregunta} Respuesta: ${f.respuesta}`),
    ].join('\n');

  async function responderLibre(neg, texto) {
    if (config.gemini.mode === 'responder' && gemini?.activo()) {
      const r = await gemini.responderConContexto({
        sistema: `Eres el asistente de WhatsApp de ${neg.nombre}.`,
        contexto: contexto(neg),
        pregunta: texto,
      });
      if (r) return `${r}\n\nEscribe *menu* para ver las opciones.`;
    }
    return `No logré entenderte 😅\n\n${menu(neg)}`;
  }

  /** @returns {Promise<string>} texto a enviar */
  async function reply(phone, texto, ahora = Date.now()) {
    const neg = await leerNegocio();
    let conv = store.conversacion(phone) ?? { state: 'menu', context: {}, last: 0 };
    if (!conv.last || ahora - conv.last > config.bot.sessionMinutes * 60_000) conv = { state: 'menu', context: {}, last: 0 };

    const n = normalizar(texto);
    let respuesta;

    if (/^\[(image|audio|video|sticker|document)/i.test(texto.trim())) {
      respuesta = 'Por ahora solo puedo leer mensajes de texto. Escribe *menu* para ver las opciones.';
    } else if (SALUDOS.includes(n) || n === '0') {
      conv = { state: 'menu', context: {}, last: 0 };
      respuesta = menu(neg);
    } else if (conv.state === 'pedido') {
      // Flujo con estado. Aquí tu backend guarda el pedido: hooks.alCrearPedido({ phone, texto }) -> tu base de datos.
      conv = { state: 'menu', context: {}, last: 0 };
      await hooks.alCrearPedido?.({ phone, texto: texto.trim().slice(0, 500) });
      respuesta = `¡Gracias! Recibimos tu solicitud: "${texto.trim().slice(0, 200)}". Una persona la confirmará pronto.\n\nEscribe *menu* para volver.`;
      store.pausar(phone, 1); // que no se mezcle con respuestas automáticas mientras la atienden
    } else {
      const intent = { 1: 'precios', 2: 'info', 3: 'pedido', 4: 'humano' }[n] ?? (await classify(texto));
      switch (intent) {
        case 'precios': respuesta = precios(neg); break;
        case 'info': respuesta = info(neg); break;
        case 'humano': respuesta = humano(phone); break;
        case 'pedido':
          conv.state = 'pedido';
          respuesta = 'Perfecto. Cuéntame en un solo mensaje qué necesitas (producto, cantidad y tu nombre).';
          break;
        default: respuesta = await responderLibre(neg, texto);
      }
    }

    conv.last = ahora;
    store.guardarConversacion(phone, conv);
    return respuesta;
  }

  return { reply, menu: async () => menu(await leerNegocio()) };
}
