import { describe, it, expect } from 'vitest';
import { nuevaFinca, escenarioCampo, cosechaComercializable, D } from './helpers.js';
import { periodoAnterior } from '../src/modules/finanzas.service.js';

async function setup() {
  const f = await nuevaFinca();
  const a = await escenarioCampo(f, { codigo: 'A', cultivo: 'Tomate' });
  const b = await escenarioCampo(f, { codigo: 'B', cultivo: 'Lechuga' });
  const trab = (await f.post('/trabajadores', { nombre: 'T', tarifa_jornal: 100 })).body.data;
  const insumo = (await f.post('/productos', { categoria: 'fertilizantes', nombre: 'Fert', unidad: 'kg', stock_inicial: 100, costo_unitario: 4 })).body.data;
  return { f, a, b, trab, insumo };
}

describe('M7 · Finanzas (cálculos desde registros reales)', () => {
  it('costos por lote = insumos consumidos + jornales + gastos; ingresos = ventas; margen y rentabilidad exactos', async () => {
    const { f, a, b, trab, insumo } = await setup();
    // Lote A: insumo 25 kg × 4 = 100; jornales 2 × 100 = 200; gasto cosecha 50 → costos 350
    await f.post('/inventario/movimientos', { producto_id: insumo.id, tipo: 'salida', motivo: 'consumo', cantidad: 25, lote_id: a.lote.id, fecha: D(-10) });
    await f.post('/jornales', { trabajador_id: trab.id, fecha: D(-9), jornadas: 2, lote_id: a.lote.id });
    await f.post('/gastos', { fecha: D(-8), categoria: 'cosecha', descripcion: 'Cajas', monto: 50, lote_id: a.lote.id });
    // Lote B: jornal 100 → costos 100
    await f.post('/jornales', { trabajador_id: trab.id, fecha: D(-7), jornadas: 1, lote_id: b.lote.id });
    // Ventas: A vende 40 kg × 20 = 800
    await cosechaComercializable(f, a.lote.id, 100, D(-5));
    const prod = (await f.get('/productos?categoria=productos_cosechados')).body.data[0];
    const cli = (await f.post('/clientes', { nombre: 'C' })).body.data;
    await f.post('/ventas', { cliente_id: cli.id, fecha: D(-3), items: [{ producto_id: prod.id, cantidad: 40, precio_unitario: 20 }] });
    // gasto general sin lote y otro ingreso
    await f.post('/gastos', { fecha: D(-2), categoria: 'transporte', descripcion: 'Flete', monto: 80 });
    await f.post('/ingresos', { fecha: D(-2), descripcion: 'Otros', monto: 30 });

    const r = (await f.get('/finanzas/resumen')).body.data;
    expect(r.resumen.ingresos).toEqual({ ventas: 800, vivero: 0, otros: 30, total: 830 });
    expect(r.resumen.costos).toMatchObject({ insumos: 100, jornales: 300, cosecha: 50, transporte: 80, total: 530 });
    expect(r.resumen.margen_operativo).toBe(300); expect(r.resumen.margen_pct).toBeCloseTo(36.14, 2);
    const la = r.por_lote.find(x => x.codigo === 'A'), lb = r.por_lote.find(x => x.codigo === 'B');
    expect(la).toMatchObject({ ingresos: 800, costo_total: 350, margen: 450, rentabilidad_pct: 128.57 });
    expect(la.costos).toMatchObject({ insumos: 100, jornales: 200, cosecha: 50 });
    expect(lb).toMatchObject({ ingresos: 0, costo_total: 100, margen: -100, rentabilidad_pct: -100 });
    const ca = r.por_cultivo.find(x => x.nombre === 'Tomate');
    expect(ca).toMatchObject({ ingresos: 800, costo_total: 350, margen: 450 });
    expect(r.mensual.reduce((s, m) => s + m.ingresos, 0)).toBe(830);
  });
  it('filtros: fecha, lote, cultivo, producto, trabajador y categoría', async () => {
    const { f, a, b, trab, insumo } = await setup();
    await f.post('/jornales', { trabajador_id: trab.id, fecha: D(-20), jornadas: 1, lote_id: a.lote.id });
    await f.post('/jornales', { trabajador_id: trab.id, fecha: D(-2), jornadas: 1, lote_id: b.lote.id });
    await f.post('/inventario/movimientos', { producto_id: insumo.id, tipo: 'salida', motivo: 'consumo', cantidad: 10, lote_id: a.lote.id, fecha: D(-2) });
    const q = async (s) => (await f.get(`/finanzas/resumen?${s}`)).body.data.resumen.costos;
    expect((await q('')).total).toBe(240);
    expect((await q(`desde=${D(-5)}`)).total).toBe(140);
    expect((await q(`hasta=${D(-10)}`)).total).toBe(100);
    expect((await q(`lote_id=${a.lote.id}`)).total).toBe(140);
    expect((await q(`cultivo_id=${b.cultivo.id}`)).total).toBe(100);
    expect((await q(`producto_id=${insumo.id}`)).total).toBe(40);
    expect((await q(`trabajador_id=${trab.id}`)).total).toBe(200);
    expect((await q('categoria=insumos')).total).toBe(40);
  });
  it('anulaciones y borradores no generan ingresos; cobros y cuentas por cobrar se reportan', async () => {
    const { f, a } = await setup();
    await cosechaComercializable(f, a.lote.id, 100, D(-5));
    const prod = (await f.get('/productos?categoria=productos_cosechados')).body.data[0];
    const cli = (await f.post('/clientes', { nombre: 'C' })).body.data;
    const v1 = (await f.post('/ventas', { cliente_id: cli.id, items: [{ producto_id: prod.id, cantidad: 10, precio_unitario: 10 }], metodo_pago: 'credito', monto_pagado: 30 })).body.data;
    await f.post('/ventas', { cliente_id: cli.id, items: [{ producto_id: prod.id, cantidad: 10, precio_unitario: 10 }], confirmar: false });
    const v3 = (await f.post('/ventas', { cliente_id: cli.id, items: [{ producto_id: prod.id, cantidad: 5, precio_unitario: 10 }] })).body.data;
    await f.post(`/ventas/${v3.id}/anular`, { motivo: 'x' });
    const r = (await f.get('/finanzas/resumen')).body.data.resumen;
    expect(r.ingresos.ventas).toBe(100);                          // solo v1
    expect(r.cuentas_por_cobrar).toBe(70); expect(r.cobros_recibidos).toBe(30);      // los cobros de ventas anuladas no se cuentan (se devuelven)
    expect(v1.saldo).toBe(70);
  });
  it('comparación de períodos usa el período anterior de igual duración', async () => {
    const f = await nuevaFinca();
    await f.post('/gastos', { fecha: D(-3), categoria: 'otros', descripcion: 'actual', monto: 200 });
    await f.post('/gastos', { fecha: D(-13), categoria: 'otros', descripcion: 'anterior', monto: 100 });
    await f.post('/ingresos', { fecha: D(-3), descripcion: 'i', monto: 500 });
    const c = (await f.get(`/finanzas/comparacion?desde=${D(-9)}&hasta=${D(0)}`)).body.data;
    expect(c.periodo_anterior).toEqual({ desde: D(-19), hasta: D(-10) });
    expect(c.actual.costos.total).toBe(200); expect(c.anterior.costos.total).toBe(100);
    expect(c.variacion).toMatchObject({ costos_pct: 100, costos_abs: 100, ingresos_abs: 500, margen_abs: 400 });
    expect(periodoAnterior('2026-03-01', '2026-03-10')).toEqual({ desde: '2026-02-19', hasta: '2026-02-28' });
  });
  it('exporta a Excel y PDF (archivos reales)', async () => {
    const f = await nuevaFinca(); await f.post('/ingresos', { fecha: D(-1), descripcion: 'x', monto: 10 });
    const parse = (res, cb) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
    const x = await f.get('/finanzas/exportar?formato=xlsx').buffer(true).parse(parse);
    expect(x.headers['content-type']).toMatch(/spreadsheetml/); expect(x.body.subarray(0, 2).toString()).toBe('PK');
    const p = await f.get('/finanzas/exportar?formato=pdf').buffer(true).parse(parse);
    expect(p.headers['content-type']).toBe('application/pdf'); expect(p.body.subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('gastos: CRUD con validaciones y solo propietario accede', async () => {
    const f = await nuevaFinca();
    expect((await f.post('/gastos', { fecha: D(0), categoria: 'otros', descripcion: 'x', monto: -5 })).status).toBe(400);
    expect((await f.post('/gastos', { fecha: D(0), categoria: 'inventada', descripcion: 'x', monto: 5 })).status).toBe(400);
    const g = (await f.post('/gastos', { fecha: D(0), categoria: 'servicios', descripcion: 'Luz', monto: 75.5 })).body.data;
    expect((await f.put(`/gastos/${g.id}`, { monto: 80 })).body.data.monto).toBe(80);
    expect((await f.del(`/gastos/${g.id}`)).status).toBe(200);
  });
});
