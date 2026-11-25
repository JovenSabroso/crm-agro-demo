import request from 'supertest';
import { createApp } from '../src/app.js';
import { addDays, today } from '../src/core/utils.js';

export const app = createApp();
export const D = (n) => addDays(today(), n);
let n = 0;

/** Crea una finca nueva (con propietario) y devuelve un contexto con helpers HTTP autenticados. */
export async function nuevaFinca(nombre = 'Finca Test') {
  const email = `owner${++n}-${Date.now()}@t.test`;
  const r = await request(app).post('/api/auth/registro').send({ finca: { nombre }, nombre: 'Dueño', email, password: 'Clave1234' });
  if (r.status !== 201) throw new Error('registro falló: ' + JSON.stringify(r.body));
  return contexto(r.body.data.token, { email, fincaId: r.body.data.finca.id });
}
export function contexto(token, extra = {}) {
  const h = { Authorization: `Bearer ${token}` };
  return {
    token, h, ...extra,
    get: (u) => request(app).get('/api' + u).set(h),
    post: (u, b) => request(app).post('/api' + u).set(h).send(b ?? {}),
    put: (u, b) => request(app).put('/api' + u).set(h).send(b ?? {}),
    patch: (u, b) => request(app).patch('/api' + u).set(h).send(b ?? {}),
    del: (u) => request(app).delete('/api' + u).set(h),
  };
}
/** Crea un usuario con rol dado en la finca de `owner` y devuelve su contexto. */
export async function usuarioConRol(owner, rol) {
  const email = `${rol}${++n}-${Date.now()}@t.test`;
  const c = await owner.post('/usuarios', { nombre: `U ${rol}`, email, password: 'Clave1234', rol });
  if (c.status !== 201) throw new Error('crear usuario falló: ' + JSON.stringify(c.body));
  const l = await request(app).post('/api/auth/login').send({ email, password: 'Clave1234' });
  return contexto(l.body.data.token, { email, userId: c.body.data.id });
}
/** Lote + cultivo + plantación activa. */
export async function escenarioCampo(ctx, { siembra = D(-60), unidad = 'kg', cultivo = 'Tomate', codigo = 'L1' } = {}) {
  const lote = (await ctx.post('/lotes', { codigo, nombre: `Lote ${codigo}`, superficie_ha: 1 })).body.data;
  const cult = (await ctx.post('/cultivos', { nombre: cultivo, tipo: 'hortaliza', unidad_cosecha: unidad })).body.data;
  const pl = await ctx.post('/plantaciones', { lote_id: lote.id, cultivo_id: cult.id, fecha_siembra: siembra, fecha_cosecha_estimada: D(10) });
  if (pl.status !== 201) throw new Error('plantación falló: ' + JSON.stringify(pl.body));
  return { lote, cultivo: cult, plantacion: pl.body.data };
}
export async function cosechaComercializable(ctx, loteId, cantidad = 100, fecha = D(-1)) {
  const r = await ctx.post('/cosechas', { lote_id: loteId, fecha, cantidad, comercializable: true, ingresar_inventario: true });
  if (r.status !== 201) throw new Error('cosecha falló: ' + JSON.stringify(r.body));
  return r.body.data;
}
