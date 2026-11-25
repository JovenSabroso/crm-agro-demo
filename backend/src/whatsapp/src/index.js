// Generado: 25/11/2026 07:35
// MÓDULO REUTILIZABLE. Se importa desde cualquier backend Node/Express:
//
//   import { crearModuloWhatsApp } from './whatsapp-modulo/src/index.js';
//   const wa = crearModuloWhatsApp({
//     config: loadConfig(),                    // o tus propios valores (ver config.js)
//     logger: pino(),
//     negocio: async () => ({ ... }),          // datos desde TU base de datos (o un objeto fijo)
//     autenticar: miMiddlewareDeAdmin,         // opcional: el login/JWT que ya tiene tu backend
//     hooks: { alCrearPedido, alRecibirLote, alResponder },   // opcionales: guardar en tu BD
//   });
//   app.use('/api/whatsapp', wa.router);       // monta la API REST
//   wa.iniciar();                              // conecta WhatsApp (tras app.listen)
//   // al apagar tu servidor: await wa.detener();
//
// No hace app.listen, no registra process.on(...) ni llama a process.exit: eso lo decide tu backend.
import { createBatcher } from './batcher.js';
import { createEngine } from './engine.js';
import { createGemini } from './gemini.js';
import { createClassifier, normalizar } from './intents.js';
import { crearRouter } from './rutas.js';
import { StateStore } from './store.js';
import { createWhatsApp } from './whatsapp.js';

const mask = (phone) => `***${String(phone).slice(-4)}`;
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function crearModuloWhatsApp({ config, logger, negocio, autenticar, hooks = {}, fetchImpl }) {
  if (!config) throw new Error('crearModuloWhatsApp: falta config');
  if (!negocio) throw new Error('crearModuloWhatsApp: falta negocio (objeto o función)');
  if (!autenticar && String(config.adminToken ?? '').length < 24) {
    throw new Error('crearModuloWhatsApp: pasa `autenticar` (tu middleware de login) o define ADMIN_TOKEN de 24+ caracteres');
  }
  logger ??= { info() {}, warn() {}, error() {}, fatal() {}, child() { return this; } };

  const store = new StateStore(config.stateFile);
  const gemini = createGemini(config.gemini, { logger, ...(fetchImpl ? { fetchImpl } : {}) });
  const nombreNegocio = typeof negocio === 'function' ? 'el negocio' : negocio.nombre;
  const classify = createClassifier({ gemini, nombreNegocio });
  const engine = createEngine({ negocio, classify, gemini, store, config, hooks });

  // "baja" cuenta como palabra completa: "rebaja" no es una baja.
  const patronesBaja = config.wa.optoutKeywords.map((k) => new RegExp(`\\b${escapar(normalizar(k))}\\b`));
  const pideBaja = (texto) => patronesBaja.some((re) => re.test(normalizar(texto)));

  let wa;
  const jidDe = (phone) => `${phone}@s.whatsapp.net`;

  async function responder({ phone, text, messages }) {
    if (!store.habilitado || store.estaDeBaja(phone) || store.estaPausado(phone)) return;
    logger.info({ phone: mask(phone), mensajes: messages.length }, 'Lote recibido'); // nunca el texto
    await hooks.alRecibirLote?.({ phone, text, messages });

    if (pideBaja(text)) {
      store.darDeBaja(phone);
      await wa.enviar(jidDe(phone), 'Listo, no te enviaremos más mensajes automáticos. Gracias.', { retraso: false });
      return;
    }

    let respuesta;
    try {
      respuesta = await engine.reply(phone, text);
    } catch (err) {
      logger.error({ err: err.message }, 'Fallo del motor del bot');
      respuesta = 'Tuvimos un inconveniente técnico. Por favor, inténtalo de nuevo en unos minutos.';
    }
    await wa.enviar(jidDe(phone), respuesta);
    await hooks.alResponder?.({ phone, text, respuesta });
  }

  const batcher = createBatcher({
    windowMs: config.wa.batchWindowMs,
    maxWaitMs: config.wa.batchMaxWaitMs,
    onBatch: (lote) => responder(lote).catch((err) => logger.error({ err: err.message, phone: mask(lote.phone) }, 'Error al responder')),
  });

  wa = createWhatsApp({
    config,
    logger,
    onMensaje: (m) => batcher.add(m.phone, m),
    onEscribiendo: (phone) => batcher.typing(phone),
  });

  const modulo = {
    store, gemini, engine, wa, batcher,

    /** Conecta WhatsApp (si el módulo está habilitado). Llamar después de app.listen. */
    iniciar() { if (store.habilitado) return wa.conectar(); return wa.estado(); },

    /** Apagado limpio: entrega lotes pendientes, guarda el estado y cierra la conexión. */
    async detener() { batcher.flushAll(); store.flush(); wa.cerrar(); },

    estado: () => ({
      whatsapp: wa.estado(),
      habilitado: store.habilitado,
      gemini: { activo: gemini.activo(), claves: config.gemini.keys.length, modelo: config.gemini.model, modo: config.gemini.mode },
      pendientes: batcher.pendientes(),
    }),

    habilitar(valor) {
      store.setHabilitado(valor);
      if (valor) wa.conectar(); else wa.cerrar();
      return modulo.estado();
    },

    /** Para que tu backend escriba a un cliente (ej. "tu pedido está listo"). Respeta bajas y pausas. */
    async enviar(phone, texto, { retraso = true } = {}) {
      if (store.estaDeBaja(phone)) throw new Error('El cliente pidió no recibir mensajes');
      await wa.enviar(jidDe(phone), texto, { retraso });
    },
  };

  modulo.router = crearRouter({ modulo, config, autenticar });
  return modulo;
}

export { loadConfig, validateConfig } from './config.js';
