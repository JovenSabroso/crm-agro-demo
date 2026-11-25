// Generado: 25/11/2026 06:30
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGemini } from '../src/gemini.js';

const silencio = { warn() {} };
const respuesta = (status, texto) => ({
  ok: status === 200,
  status,
  json: async () => ({ candidates: [{ content: { parts: [{ text: texto }] } }] }),
});

test('si el modelo principal da 429, responde el de respaldo', async () => {
  const llamadas = [];
  const fetchImpl = async (url, opts) => {
    llamadas.push({ url, clave: opts.headers['x-goog-api-key'] });
    return url.includes('modelo-a') ? respuesta(429, '') : respuesta(200, '{"intent":"precios"}');
  };
  const g = createGemini({ keys: ['K1'], model: 'modelo-a', fallbackModels: ['modelo-b'] }, { fetchImpl, logger: silencio });
  const intent = await g.clasificar({ sistema: 's', texto: 'cuanto sale', etiquetas: ['precios', 'otro'] });
  assert.equal(intent, 'precios');
  assert.ok(llamadas[0].url.includes('modelo-a') && llamadas[1].url.includes('modelo-b'));
});

test('la clave viaja en la cabecera, nunca en la URL', async () => {
  let visto;
  const fetchImpl = async (url, opts) => { visto = { url, cabecera: opts.headers['x-goog-api-key'] }; return respuesta(200, '{"intent":"otro"}'); };
  const g = createGemini({ keys: ['SECRETA'], model: 'm' }, { fetchImpl, logger: silencio });
  await g.clasificar({ sistema: 's', texto: 'x', etiquetas: ['otro'] });
  assert.equal(visto.cabecera, 'SECRETA');
  assert.ok(!visto.url.includes('SECRETA'));
});

test('rota entre claves y recuerda cuál está en descanso', async () => {
  const usadas = [];
  const fetchImpl = async (_u, opts) => {
    const k = opts.headers['x-goog-api-key'];
    usadas.push(k);
    return k === 'K1' ? respuesta(429, '') : respuesta(200, '{"intent":"otro"}');
  };
  const g = createGemini({ keys: ['K1', 'K2'], model: 'm' }, { fetchImpl, logger: silencio });
  await g.clasificar({ sistema: 's', texto: 'x', etiquetas: ['otro'] });
  usadas.length = 0;
  await g.clasificar({ sistema: 's', texto: 'x', etiquetas: ['otro'] });
  assert.deepEqual(usadas, ['K2']); // K1 descansa: no se vuelve a intentar enseguida
});

test('una etiqueta fuera de la lista se descarta (la IA no puede inventar)', async () => {
  const fetchImpl = async () => respuesta(200, '{"intent":"borrar_todo"}');
  const g = createGemini({ keys: ['K'], model: 'm' }, { fetchImpl, logger: silencio });
  assert.equal(await g.clasificar({ sistema: 's', texto: 'x', etiquetas: ['precios', 'otro'] }), null);
});

test('si todo falla devuelve null y no lanza (hay plan B sin IA)', async () => {
  const fetchImpl = async () => respuesta(500, '');
  const g = createGemini({ keys: ['K'], model: 'm', fallbackModels: ['n'] }, { fetchImpl, logger: silencio });
  assert.equal(await g.clasificar({ sistema: 's', texto: 'x', etiquetas: ['otro'] }), null);
  assert.equal(await g.responderConContexto({ sistema: 's', contexto: 'c', pregunta: 'p' }), null);
});

test('thinkingBudget solo se envía a los modelos 2.5', async () => {
  const cuerpos = {};
  const fetchImpl = async (url, opts) => { cuerpos[url.includes('2.5') ? '2.5' : '3.x'] = JSON.parse(opts.body); return respuesta(200, '{"intent":"otro"}'); };
  const g1 = createGemini({ keys: ['K'], model: 'gemini-2.5-flash' }, { fetchImpl, logger: silencio });
  const g2 = createGemini({ keys: ['K'], model: 'gemini-3.5-flash-lite' }, { fetchImpl, logger: silencio });
  await g1.clasificar({ sistema: 's', texto: 'x', etiquetas: ['otro'] });
  await g2.clasificar({ sistema: 's', texto: 'x', etiquetas: ['otro'] });
  assert.ok(cuerpos['2.5'].generationConfig.thinkingConfig);
  assert.equal(cuerpos['3.x'].generationConfig.thinkingConfig, undefined);
});
