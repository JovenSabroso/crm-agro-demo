import { describe, it, expect } from 'vitest';
import { nuevaFinca, escenarioCampo, D } from './helpers.js';

describe('M1 · Control de campo y períodos de carencia', () => {
  it('calcula la fecha de fin de carencia = aplicación + días', async () => {
    const f = await nuevaFinca(); const { lote } = await escenarioCampo(f);
    const r = await f.post('/aplicaciones', { lote_id: lote.id, producto_nombre: 'Fungicida X', motivo: 'Hongos', fecha_aplicacion: D(-3), periodo_carencia_dias: 10 });
    expect(r.status).toBe(201);
    expect(r.body.data.estado).toBe('aplicada');
    expect(r.body.data.fecha_fin_carencia).toBe(D(7));
    expect(r.body.data.carencia_vigente).toBe(1);
    expect(r.body.data.dias_carencia_restantes).toBe(7);
  });
  it('NO permite marcar como comercializable una cosecha dentro del período de carencia', async () => {
    const f = await nuevaFinca(); const { lote } = await escenarioCampo(f);
    await f.post('/aplicaciones', { lote_id: lote.id, producto_nombre: 'Insecticida Y', motivo: 'Plaga', fecha_aplicacion: D(-2), periodo_carencia_dias: 7 });
    // al crear con comercializable=true se rechaza y no se guarda nada
    const bad = await f.post('/cosechas', { lote_id: lote.id, fecha: D(0), cantidad: 50, comercializable: true });
    expect(bad.status).toBe(422); expect(bad.body.error.message).toMatch(/carencia/i);
    expect((await f.get('/cosechas')).body.data).toHaveLength(0);
    // registrar la cosecha sin marcarla sí es posible (es un hecho), pero queda retenida
    const ok = await f.post('/cosechas', { lote_id: lote.id, fecha: D(0), cantidad: 50 });
    expect(ok.status).toBe(201); expect(ok.body.data.comercializable).toBe(0);
    expect(ok.body.data.carencia_incumplida).toHaveLength(1);
    const patch = await f.patch(`/cosechas/${ok.body.data.id}/comercializable`, { comercializable: true });
    expect(patch.status).toBe(422); expect(patch.body.error.details.aplicaciones[0].producto_nombre).toBe('Insecticida Y');
  });
  it('una cosecha posterior al fin de la carencia sí puede comercializarse; la del último día de carencia también', async () => {
    const f = await nuevaFinca(); const { lote } = await escenarioCampo(f);
    await f.post('/aplicaciones', { lote_id: lote.id, producto_nombre: 'Z', motivo: 'm', fecha_aplicacion: D(-10), periodo_carencia_dias: 7 });  // termina D(-3)
    expect((await f.post('/cosechas', { lote_id: lote.id, fecha: D(-3), cantidad: 10, comercializable: true })).status).toBe(201);
    expect((await f.post('/cosechas', { lote_id: lote.id, fecha: D(-4), cantidad: 10, comercializable: true })).status).toBe(422);
    expect((await f.post('/cosechas', { lote_id: lote.id, fecha: D(-1), cantidad: 10, comercializable: true })).status).toBe(201);
  });
  it('aplicaciones pendientes: alerta, aplicar y descuento de inventario (sin inventar dosis)', async () => {
    const f = await nuevaFinca(); const { lote } = await escenarioCampo(f);
    const prod = (await f.post('/productos', { categoria: 'agroquimicos', nombre: 'Agroq', unidad: 'L', stock_inicial: 5, costo_unitario: 50, periodo_carencia_dias: 4, stock_minimo: 1 })).body.data;
    const p = await f.post('/aplicaciones', { lote_id: lote.id, producto_id: prod.id, motivo: 'Prevención', fecha_programada: D(-1), cantidad_usada: 2, dosis_registrada: 'Según etiqueta' });
    expect(p.body.data.estado).toBe('pendiente'); expect(p.body.data.atrasada).toBe(1);
    expect(p.body.data.periodo_carencia_dias).toBe(4);                                  // toma la carencia de la etiqueta registrada
    const alertas = (await f.get('/alertas')).body.data;
    expect(alertas.some(a => a.tipo === 'aplicacion_pendiente' && a.severidad === 'danger')).toBe(true);
    expect((await f.get(`/productos/${prod.id}`)).body.data.stock_actual).toBe(5);       // pendiente: no consume
    const ap = await f.post(`/aplicaciones/${p.body.data.id}/aplicar`, { fecha_aplicacion: D(0) });
    expect(ap.status).toBe(200); expect(ap.body.data.fecha_fin_carencia).toBe(D(4));
    expect((await f.get(`/productos/${prod.id}`)).body.data.stock_actual).toBe(3);
    expect((await f.post(`/aplicaciones/${p.body.data.id}/aplicar`, {})).status).toBe(422);   // no se aplica dos veces
    const alertas2 = (await f.get('/alertas')).body.data;
    expect(alertas2.some(a => a.tipo === 'carencia')).toBe(true);
  });
  it('rechaza aplicar un producto que no es agroquímico y aplicaciones sin producto', async () => {
    const f = await nuevaFinca(); const { lote } = await escenarioCampo(f);
    const fert = (await f.post('/productos', { categoria: 'fertilizantes', nombre: 'Fert', unidad: 'kg' })).body.data;
    expect((await f.post('/aplicaciones', { lote_id: lote.id, producto_id: fert.id, motivo: 'x', fecha_programada: D(1) })).status).toBe(400);
    expect((await f.post('/aplicaciones', { lote_id: lote.id, motivo: 'x', fecha_programada: D(1) })).status).toBe(400);
  });
  it('una cosecha exige un cultivo activo en el lote y no puede ser anterior a la siembra', async () => {
    const f = await nuevaFinca();
    const lote = (await f.post('/lotes', { codigo: 'V1', nombre: 'Vacío' })).body.data;
    expect((await f.post('/cosechas', { lote_id: lote.id, fecha: D(0), cantidad: 5 })).status).toBe(422);
    const { lote: l2 } = await escenarioCampo(f, { siembra: D(-10), codigo: 'L2' });
    expect((await f.post('/cosechas', { lote_id: l2.id, fecha: D(-20), cantidad: 5 })).status).toBe(422);
  });
  it('un lote no puede tener dos cultivos activos a la vez', async () => {
    const f = await nuevaFinca(); const { lote } = await escenarioCampo(f);
    const c2 = (await f.post('/cultivos', { nombre: 'Lechuga' })).body.data;
    expect((await f.post('/plantaciones', { lote_id: lote.id, cultivo_id: c2.id, fecha_siembra: D(-5) })).status).toBe(409);
  });
  it('valida cantidades y fechas inválidas', async () => {
    const f = await nuevaFinca(); const { lote } = await escenarioCampo(f);
    expect((await f.post('/cosechas', { lote_id: lote.id, fecha: D(0), cantidad: -5 })).status).toBe(400);
    expect((await f.post('/cosechas', { lote_id: lote.id, fecha: '2026-13-45', cantidad: 5 })).status).toBe(400);
    expect((await f.post('/labores', { lote_id: lote.id, tipo: '', fecha_programada: D(0) })).status).toBe(400);
  });
  it('calendario agrícola reúne labores, riegos y cosechas estimadas', async () => {
    const f = await nuevaFinca(); const { lote } = await escenarioCampo(f);
    await f.post('/labores', { lote_id: lote.id, tipo: 'Poda', fecha_programada: D(2) });
    await f.post('/riegos', { lote_id: lote.id, fecha: D(0), metodo: 'goteo', volumen_litros: 500 });
    const ev = (await f.get(`/campo/calendario?desde=${D(-1)}&hasta=${D(15)}`)).body.data;
    expect(ev.map(e => e.tipo)).toEqual(expect.arrayContaining(['labor', 'riego', 'cosecha_estimada']));
  });
  it('sanitiza HTML en textos (defensa XSS)', async () => {
    const f = await nuevaFinca();
    const r = await f.post('/lotes', { codigo: 'XSS', nombre: '<script>alert(1)</script>Lote <b>seguro</b>' });
    expect(r.body.data.nombre).toBe('alert(1)Lote seguro');
    expect(r.body.data.nombre).not.toMatch(/</);
  });
  it('protege contra inyección SQL en búsquedas y ordenamiento', async () => {
    const f = await nuevaFinca(); await f.post('/lotes', { codigo: 'S1', nombre: 'Normal' });
    const r = await f.get("/lotes?q=' OR 1=1 --&sort=nombre;DROP TABLE lotes&dir=asc");
    expect(r.status).toBe(200); expect(r.body.data).toHaveLength(0);
    expect((await f.get('/lotes')).body.data).toHaveLength(1);
  });
});
