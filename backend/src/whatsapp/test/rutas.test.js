// Generado: 25/11/2026 08:00
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import express from 'express';
import { crearRouter } from '../src/rutas.js';

const TOKEN = 'token-de-prueba-largo-123456789';
const enviados = [];
const modulo = {
  store: { data: { bajas: ['59170000001'], pausas: { '59170000002': Date.now() + 1e6 } }, estaPausado: () => true, pausar() {}, reanudar() {}, reactivar() {} },
  wa: { estado: () => ({ estado: 'qr' }), qrComoImagen: async () => 'data:image/png;base64,AAAA', conectar: async () => ({ estado: 'conectando' }), desvincular: async () => {} },
  estado: () => ({ whatsapp: { estado: 'qr', cuenta: null }, habilitado: true, gemini: { activo: false }, pendientes: 0 }),
  habilitar: (v) => ({ habilitado: v }),
  enviar: async (to, text, op) => { if (to === '59170000009') throw new Error('El cliente pidió no recibir mensajes'); enviados.push({ to, text, op }); },
};

function servir(opciones) {
  const app = express();
  app.use('/api/whatsapp', crearRouter({ modulo, config: { adminToken: TOKEN }, ...opciones }));
  return new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}/api/whatsapp` })); });
}
const llamar = (url, ruta, { token = TOKEN, metodo = 'GET', cuerpo } = {}) =>
  fetch(url + ruta, { method: metodo, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });

let a; let b;
before(async () => { a = await servir({}); b = await servir({ autenticar: (req, res, next) => (req.get('x-rol') === 'admin' ? next() : res.status(403).json({ error: 'solo admin' })) }); });
after(() => { a.s.close(); b.s.close(); });

test('sin token o con token incorrecto: 401', async () => {
  assert.equal((await llamar(a.url, '/estado', { token: '' })).status, 401);
  assert.equal((await llamar(a.url, '/estado', { token: 'otro' })).status, 401);
});

test('con el token correcto devuelve el estado y el QR', async () => {
  assert.equal((await (await llamar(a.url, '/estado')).json()).habilitado, true);
  const q = await (await llamar(a.url, '/qr')).json();
  assert.equal(q.estado, 'qr');
  assert.match(q.qr, /^data:image\/png/);
});

test('el panel HTML es público (la API sigue protegida)', async () => {
  const r = await fetch(`${a.url}/panel`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /WhatsApp · Administración/);
});

test('enviar valida teléfono y texto, y envía con retraso por defecto', async () => {
  assert.equal((await llamar(a.url, '/enviar', { metodo: 'POST', cuerpo: { to: '123', text: 'hola' } })).status, 422);
  assert.equal((await llamar(a.url, '/enviar', { metodo: 'POST', cuerpo: { to: '59170000000', text: '  ' } })).status, 422);
  assert.equal((await llamar(a.url, '/enviar', { metodo: 'POST', cuerpo: { to: '59170000000', text: 'x'.repeat(1001) } })).status, 422);
  assert.equal((await llamar(a.url, '/enviar', { metodo: 'POST', cuerpo: { to: '59170000000', text: 'Hola' } })).status, 200);
  assert.deepEqual(enviados.at(-1), { to: '59170000000', text: 'Hola', op: { retraso: true } });
});

test('un cliente de baja no recibe mensajes (409)', async () => {
  assert.equal((await llamar(a.url, '/enviar', { metodo: 'POST', cuerpo: { to: '59170000009', text: 'Hola' } })).status, 409);
});

test('habilitar exige un booleano', async () => {
  assert.equal((await llamar(a.url, '/habilitar', { metodo: 'POST', cuerpo: { habilitado: 'si' } })).status, 422);
  assert.equal((await (await llamar(a.url, '/habilitar', { metodo: 'POST', cuerpo: { habilitado: false } })).json()).habilitado, false);
});

test('lista de conversaciones y validación del teléfono en las rutas con parámetro', async () => {
  const c = await (await llamar(a.url, '/conversaciones')).json();
  assert.deepEqual(c.bajas, ['59170000001']);
  assert.deepEqual(c.pausas, ['59170000002']);
  assert.equal((await llamar(a.url, '/conversaciones/abc/pausar', { metodo: 'POST', cuerpo: {} })).status, 422);
  assert.equal((await llamar(a.url, '/conversaciones/59170000002/reanudar', { metodo: 'POST' })).status, 200);
});

test('con el middleware del backend (autenticar) se usa ese y no el token del módulo', async () => {
  assert.equal((await llamar(b.url, '/estado', { token: TOKEN })).status, 403);
  const r = await fetch(`${b.url}/estado`, { headers: { 'x-rol': 'admin' } });
  assert.equal(r.status, 200);
});
