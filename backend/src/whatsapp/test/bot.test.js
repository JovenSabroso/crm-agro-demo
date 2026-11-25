// Generado: 25/11/2026 06:35
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBatcher } from '../src/batcher.js';
import { loadConfig, validateConfig } from '../src/config.js';
import { createEngine } from '../src/engine.js';
import { createClassifier, normalizar, porPalabrasClave } from '../src/intents.js';

const negocio = {
  nombre: 'Tienda Prueba', saludo_extra: 'Hola.', horario: 'L-S 8 a 19', direccion: 'Calle 1', telefono: '700',
  catalogo: [{ nombre: 'A', precio: 50 }, { nombre: 'B', precio: 0 }],
  preguntas_frecuentes: [{ pregunta: '¿Envíos?', respuesta: 'Sí' }],
};
const config = loadConfig({ ADMIN_TOKEN: 'x'.repeat(30) });

function nuevoMotor({ gemini = null } = {}) {
  const store = {
    c: {}, p: {},
    conversacion(t) { return this.c[t] ?? null; },
    guardarConversacion(t, v) { this.c[t] = v; },
    pausar(t, h) { this.p[t] = h; },
  };
  const classify = createClassifier({ gemini, nombreNegocio: negocio.nombre });
  return { store, engine: createEngine({ negocio, classify, gemini, store, config }) };
}

test('normalizar quita tildes y mayúsculas', () => {
  assert.equal(normalizar('  ¿Dónde ESTÁN? '), '¿donde estan?');
});

test('palabras clave: lo específico va primero', () => {
  assert.equal(porPalabrasClave('cuánto cuesta el pedido'), 'precios');
  assert.equal(porPalabrasClave('quiero hablar con una persona'), 'humano');
  assert.equal(porPalabrasClave('a qué hora abren'), 'info');
  assert.equal(porPalabrasClave('asdf'), null);
});

test('el saludo muestra el menú y "2" da horario y dirección de la BD', async () => {
  const { engine } = nuevoMotor();
  assert.match(await engine.reply('591', 'Hola'), /Precios/);
  const info = await engine.reply('591', '2');
  assert.match(info, /L-S 8 a 19/);
  assert.match(info, /Calle 1/);
});

test('los precios salen del catálogo y no muestra los de precio 0', async () => {
  const { engine } = nuevoMotor();
  const r = await engine.reply('591', '1');
  assert.match(r, /A: Bs 50,00/);
  assert.doesNotMatch(r, /B:/);
});

test('"hablar con una persona" pausa el bot', async () => {
  const { engine, store } = nuevoMotor();
  await engine.reply('591', '4');
  assert.equal(store.p['591'], config.bot.humanPauseHours);
});

test('un mensaje libre sin IA vuelve al menú (nunca se queda mudo)', async () => {
  const { engine } = nuevoMotor();
  assert.match(await engine.reply('591', 'asdfgh qwerty'), /No logré entenderte/);
});

test('con Gemini caído, el mensaje libre se entiende por palabras clave o cae al menú', async () => {
  const gemini = { activo: () => true, clasificar: async () => null, responderConContexto: async () => null };
  const { engine } = nuevoMotor({ gemini });
  assert.match(await engine.reply('591', 'asdfgh'), /No logré entenderte/);
});

test('con Gemini, un mensaje libre se clasifica en una etiqueta válida', async () => {
  const gemini = { activo: () => true, clasificar: async () => 'info', responderConContexto: async () => null };
  const { engine } = nuevoMotor({ gemini });
  assert.match(await engine.reply('591', 'jkl mnop'), /Dirección:/);
});

test('modo "responder": usa el contexto del negocio y, si la IA falla, cae al menú', async () => {
  const cfg = loadConfig({ ADMIN_TOKEN: 'x'.repeat(30), MODO_IA: 'responder' });
  const store = { conversacion: () => null, guardarConversacion() {}, pausar() {} };
  let contextoVisto = '';
  const gemini = { activo: () => true, clasificar: async () => 'otro', responderConContexto: async ({ contexto }) => { contextoVisto = contexto; return 'Sí, hacemos envíos.'; } };
  const engine = createEngine({ negocio, classify: createClassifier({ gemini }), gemini, store, config: cfg });
  assert.match(await engine.reply('591', 'asdf zxcv'), /hacemos envíos/);
  assert.match(contextoVisto, /Producto: A; precio: Bs 50,00/);
  gemini.responderConContexto = async () => null;
  assert.match(await engine.reply('591', 'asdf zxcv'), /No logré entenderte/);
});

test('la sesión caduca y vuelve al menú', async () => {
  const { engine } = nuevoMotor();
  const t0 = 1_000_000;
  await engine.reply('591', '3', t0); // entra al flujo de pedido
  const r = await engine.reply('591', 'dos unidades de A', t0 + 31 * 60_000); // sesión vencida
  assert.doesNotMatch(r, /Recibimos tu solicitud/);
});

test('el agrupador junta mensajes seguidos en un solo lote', () => {
  const timers = [];
  const lotes = [];
  const b = createBatcher({
    windowMs: 5000, maxWaitMs: 30000, now: () => 0,
    setTimeoutImpl: (fn, ms) => { const t = { fn, ms, vivo: true, unref() {} }; timers.push(t); return t; },
    clearTimeoutImpl: (t) => { if (t) t.vivo = false; },
    onBatch: (l) => lotes.push(l),
  });
  b.add('591', { text: 'hola' });
  b.add('591', { text: 'quiero precios' });
  timers.filter((t) => t.vivo).forEach((t) => t.fn());
  assert.equal(lotes.length, 1);
  assert.equal(lotes[0].text, 'hola\nquiero precios');
});

test('la configuración exige un ADMIN_TOKEN largo y host local', () => {
  assert.ok(validateConfig(loadConfig({})).length >= 1);
  assert.deepEqual(validateConfig(loadConfig({ ADMIN_TOKEN: 'y'.repeat(30) })), []);
  assert.ok(validateConfig(loadConfig({ ADMIN_TOKEN: 'y'.repeat(30), HOST: '0.0.0.0' })).length >= 1);
});

test('el negocio puede venir de una función async (base de datos) y se lee en cada respuesta', async () => {
  let precio = 50;
  const leidas = [];
  const store = { c: {}, conversacion(t) { return this.c[t] ?? null; }, guardarConversacion(t, v) { this.c[t] = v; }, pausar() {} };
  const engine = createEngine({
    negocio: async () => { leidas.push(precio); return { ...negocio, catalogo: [{ nombre: 'A', precio }] }; },
    classify: createClassifier({}), gemini: null, store, config,
  });
  assert.match(await engine.reply('591', '1'), /A: Bs 50,00/);
  precio = 75; // el precio cambió en la base de datos
  assert.match(await engine.reply('591', '1'), /A: Bs 75,00/);
  assert.deepEqual(leidas, [50, 75]);
});

test('el flujo de pedido llama al hook alCrearPedido con el texto del cliente', async () => {
  const pedidos = [];
  const store = { c: {}, conversacion(t) { return this.c[t] ?? null; }, guardarConversacion(t, v) { this.c[t] = v; }, pausar() {} };
  const engine = createEngine({ negocio, classify: createClassifier({}), gemini: null, store, config, hooks: { alCrearPedido: async (p) => pedidos.push(p) } });
  await engine.reply('591', '3');
  assert.match(await engine.reply('591', '2 unidades de A, soy Ana'), /Recibimos tu solicitud/);
  assert.deepEqual(pedidos, [{ phone: '591', texto: '2 unidades de A, soy Ana' }]);
});
