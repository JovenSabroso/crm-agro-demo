import { describe, it, expect } from 'vitest';
import { nuevaFinca, D } from './helpers.js';

async function vivero(f) {
  const v = (await f.post('/viveros', { nombre: 'Vivero 1' })).body.data;
  const e = (await f.post('/especies', { nombre: 'Tomate', variedad: 'Cherry', precio_plantin: 2 })).body.data;
  const s = (await f.post('/vivero/siembras', { vivero_id: v.id, especie_id: e.id, fecha_siembra: D(-30), cantidad_sembrada: 1000 })).body.data;
  return { v, e, s };
}

describe('M6 · Vivero', () => {
  it('registra siembra y calcula existentes, disponibles, vendidos y tasa de germinación', async () => {
    const f = await nuevaFinca(); const { s } = await vivero(f);
    expect(s.codigo).toBe('SV-0001'); expect(s.disponibles).toBe(0);
    await f.post(`/vivero/siembras/${s.id}/movimientos`, { tipo: 'germinacion', cantidad: 900 });
    await f.post(`/vivero/siembras/${s.id}/movimientos`, { tipo: 'perdida', cantidad: 50 });
    const x = (await f.get(`/vivero/siembras/${s.id}`)).body.data;
    expect(x).toMatchObject({ germinadas: 900, perdidas: 50, existentes: 850, disponibles: 850, vendidas: 0, tasa_germinacion: 90 });
  });
  it('valida: no germinar más de lo sembrado ni perder/trasplantar más de lo disponible', async () => {
    const f = await nuevaFinca(); const { s } = await vivero(f);
    expect((await f.post(`/vivero/siembras/${s.id}/movimientos`, { tipo: 'germinacion', cantidad: 1001 })).status).toBe(422);
    await f.post(`/vivero/siembras/${s.id}/movimientos`, { tipo: 'germinacion', cantidad: 100 });
    expect((await f.post(`/vivero/siembras/${s.id}/movimientos`, { tipo: 'perdida', cantidad: 101 })).status).toBe(422);
    expect((await f.post(`/vivero/siembras/${s.id}/movimientos`, { tipo: 'trasplante', cantidad: 40 })).status).toBe(201);
    expect((await f.post(`/vivero/siembras/${s.id}/movimientos`, { tipo: 'germinacion', cantidad: 0 })).status).toBe(400);
    expect((await f.post(`/vivero/siembras/${s.id}/movimientos`, { tipo: 'crecimiento', cantidad: 0, altura_cm: 12 })).status).toBe(201);
  });
  it('vender plantines: crea venta, descuenta el stock del vivero y no permite sobreventa', async () => {
    const f = await nuevaFinca(); const { s } = await vivero(f);
    await f.post(`/vivero/siembras/${s.id}/movimientos`, { tipo: 'germinacion', cantidad: 500 });
    const cli = (await f.post('/clientes', { nombre: 'Agricultor' })).body.data;
    const r = await f.post(`/vivero/siembras/${s.id}/vender`, { cliente_id: cli.id, cantidad: 200 });
    expect(r.status).toBe(201);
    expect(r.body.data.venta.total).toBe(400);                         // 200 × precio de la especie (2)
    expect(r.body.data.siembra).toMatchObject({ vendidas: 200, disponibles: 300 });
    expect((await f.post(`/vivero/siembras/${s.id}/vender`, { cliente_id: cli.id, cantidad: 301 })).status).toBe(422);
    expect((await f.get(`/vivero/siembras/${s.id}`)).body.data.disponibles).toBe(300);
    // anular la venta devuelve los plantines
    await f.post(`/ventas/${r.body.data.venta.id}/anular`, { motivo: 'prueba' });
    expect((await f.get(`/vivero/siembras/${s.id}`)).body.data.disponibles).toBe(500);
  });
  it('costos de producción (gastos + insumos) y costo unitario; ingresos del vivero en finanzas', async () => {
    const f = await nuevaFinca(); const { s } = await vivero(f);
    const semilla = (await f.post('/productos', { categoria: 'semillas', nombre: 'Semilla', unidad: 'sobre', stock_inicial: 10, costo_unitario: 20 })).body.data;
    await f.post('/vivero/siembras', { vivero_id: s.vivero_id, especie_id: s.especie_id, codigo: 'SV-X', fecha_siembra: D(-5), cantidad_sembrada: 100, insumos: [{ producto_id: semilla.id, cantidad: 2 }] });
    expect((await f.get(`/productos/${semilla.id}`)).body.data.stock_actual).toBe(8);
    await f.post(`/vivero/siembras/${s.id}/costos`, { fecha: D(-29), descripcion: 'Sustrato', monto: 300 });
    await f.post(`/vivero/siembras/${s.id}/movimientos`, { tipo: 'germinacion', cantidad: 600 });
    const x = (await f.get(`/vivero/siembras/${s.id}`)).body.data;
    expect(x.costo_produccion).toBe(300); expect(x.costo_unitario).toBe(0.5);
    const cli = (await f.post('/clientes', { nombre: 'C' })).body.data;
    await f.post(`/vivero/siembras/${s.id}/vender`, { cliente_id: cli.id, cantidad: 100 });
    const fin = (await f.get('/finanzas/resumen')).body.data.resumen;
    expect(fin.ingresos.vivero).toBe(200); expect(fin.costos.vivero).toBe(340);      // 300 + 2 sobres × 20
    const res = (await f.get('/vivero/resumen')).body.data;
    expect(res).toMatchObject({ siembras: 2, germinadas: 600, vendidas: 100, disponibles: 500, ingresos: 200 });
  });
  it('una siembra con ventas no puede eliminarse', async () => {
    const f = await nuevaFinca(); const { s } = await vivero(f);
    await f.post(`/vivero/siembras/${s.id}/movimientos`, { tipo: 'germinacion', cantidad: 50 });
    const cli = (await f.post('/clientes', { nombre: 'C' })).body.data;
    await f.post(`/vivero/siembras/${s.id}/vender`, { cliente_id: cli.id, cantidad: 10 });
    expect((await f.del(`/vivero/siembras/${s.id}`)).status).toBe(422);
  });
});
