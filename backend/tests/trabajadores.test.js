import { describe, it, expect } from 'vitest';
import { nuevaFinca, D } from './helpers.js';

describe('M3 · Trabajadores, jornales y pagos', () => {
  it('calcula el jornal = jornadas × tarifa y rechaza duplicados', async () => {
    const f = await nuevaFinca(); const t = (await f.post('/trabajadores', { nombre: 'Pedro', tarifa_jornal: 120 })).body.data;
    const j = await f.post('/jornales', { trabajador_id: t.id, fecha: D(-1), jornadas: 1.5 });
    expect(j.status).toBe(201); expect(j.body.data.monto).toBe(180); expect(j.body.data.tarifa).toBe(120);
    const dup = await f.post('/jornales', { trabajador_id: t.id, fecha: D(-1), jornadas: 1.5 });
    expect(dup.status).toBe(409);
    expect((await f.post('/jornales', { trabajador_id: t.id, fecha: D(-1), jornadas: 2, tipo: 'cosecha' })).status).toBe(422);   // > 3 jornadas/día
    expect((await f.post('/jornales', { trabajador_id: t.id, fecha: D(-2), jornadas: 0.5, tarifa: 100 })).body.data.monto).toBe(50);
    expect((await f.post('/jornales', { trabajador_id: t.id, fecha: D(-3), jornadas: 0 })).status).toBe(400);
  });
  it('evita cálculos con coma flotante imprecisa (redondeo a 2 decimales)', async () => {
    const f = await nuevaFinca(); const t = (await f.post('/trabajadores', { nombre: 'X', tarifa_jornal: 33.33 })).body.data;
    const j = (await f.post('/jornales', { trabajador_id: t.id, fecha: D(-1), jornadas: 0.7 })).body.data;
    expect(j.monto).toBe(23.33);
  });
  it('pago: suma jornales pendientes, descuenta anticipos y NO se puede pagar dos veces', async () => {
    const f = await nuevaFinca(); const t = (await f.post('/trabajadores', { nombre: 'Ana', tarifa_jornal: 100 })).body.data;
    for (let i = 5; i >= 1; i--) await f.post('/jornales', { trabajador_id: t.id, fecha: D(-i), jornadas: 1 });          // 500
    await f.post('/anticipos', { trabajador_id: t.id, fecha: D(-6), monto: 150 });
    await f.post('/anticipos', { trabajador_id: t.id, fecha: D(-3), monto: 600 });                                    // excede el bruto: no se descuenta
    const q = `trabajador_id=${t.id}&desde=${D(-10)}&hasta=${D(0)}`;
    const prev = (await f.get(`/pagos/calcular?${q}`)).body.data;
    expect(prev).toMatchObject({ bruto: 500, anticipos_descontados: 150, neto: 350, jornadas: 5 });
    const pago = await f.post('/pagos', { trabajador_id: t.id, periodo_desde: D(-10), periodo_hasta: D(0) });
    expect(pago.status).toBe(201); expect(pago.body.data).toMatchObject({ bruto: 500, anticipos_descontados: 150, neto: 350, jornales_pagados: 5 });
    const otra = await f.post('/pagos', { trabajador_id: t.id, periodo_desde: D(-10), periodo_hasta: D(0) });
    expect(otra.status).toBe(422); expect(otra.body.error.message).toMatch(/pendientes/);
    expect((await f.get('/pagos')).body.meta.total).toBe(1);
    expect((await f.get(`/jornales?trabajador_id=${t.id}&pagado=0`)).body.meta.total).toBe(0);
    const rep = (await f.get(`/trabajadores/${t.id}/reporte`)).body.data;
    expect(rep.total_pagado).toBe(350); expect(rep.anticipos_pendientes).toBe(600); expect(rep.jornales.pendiente).toBe(0);
  });
  it('jornales pagados no pueden eliminarse; anular el pago los libera para volver a pagarse una sola vez', async () => {
    const f = await nuevaFinca(); const t = (await f.post('/trabajadores', { nombre: 'Luis', tarifa_jornal: 100 })).body.data;
    const j = (await f.post('/jornales', { trabajador_id: t.id, fecha: D(-1), jornadas: 1 })).body.data;
    const pago = (await f.post('/pagos', { trabajador_id: t.id, periodo_desde: D(-3), periodo_hasta: D(0) })).body.data;
    expect((await f.del(`/jornales/${j.id}`)).status).toBe(422);
    expect((await f.del(`/pagos/${pago.id}`)).status).toBe(200);
    expect((await f.post('/pagos', { trabajador_id: t.id, periodo_desde: D(-3), periodo_hasta: D(0) })).status).toBe(201);
    expect((await f.post('/pagos', { trabajador_id: t.id, periodo_desde: D(-3), periodo_hasta: D(0) })).status).toBe(422);
  });
  it('asistencia: registro individual, corrección, planilla masiva y resumen', async () => {
    const f = await nuevaFinca();
    const ids = []; for (const n of ['A', 'B', 'C', 'D']) ids.push((await f.post('/trabajadores', { nombre: n })).body.data.id);
    const hoy = D(0);
    expect((await f.post('/asistencia', { trabajador_id: ids[0], estado: 'presente', hora_entrada: '07:00' })).status).toBe(201);
    await f.post('/asistencia', { trabajador_id: ids[0], estado: 'retraso', hora_entrada: '08:30', justificacion: 'Transporte' });  // corrige, no duplica
    expect((await f.get(`/asistencia?trabajador_id=${ids[0]}`)).body.meta.total).toBe(1);
    await f.post('/asistencia/lote', { fecha: hoy, registros: [{ trabajador_id: ids[1], estado: 'ausente', justificacion: 'Enfermedad' }, { trabajador_id: ids[2], estado: 'presente' }] });
    const r = (await f.get('/asistencia/resumen')).body.data;
    expect(r).toMatchObject({ activos: 4, presentes: 1, ausentes: 1, retrasos: 1, sin_registro: 1 });
    expect((await f.get(`/asistencia?estado=ausente&desde=${hoy}&hasta=${hoy}`)).body.data[0].justificacion).toBe('Enfermedad');
    expect((await f.get('/asistencia/dia')).body.data).toHaveLength(4);
    expect((await f.post('/asistencia', { trabajador_id: ids[0], estado: 'otro' })).status).toBe(400);
  });
  it('tareas asignadas a trabajadores y trabajadores con historial no se eliminan', async () => {
    const f = await nuevaFinca(); const t = (await f.post('/trabajadores', { nombre: 'Marta', tarifa_jornal: 90 })).body.data;
    const tarea = await f.post('/tareas', { trabajador_id: t.id, titulo: 'Fumigar lote 1', fecha: D(1) });
    expect(tarea.status).toBe(201); expect(tarea.body.data.trabajador_nombre).toBe('Marta');
    await f.post('/jornales', { trabajador_id: t.id, fecha: D(-1), jornadas: 1 });
    const del = await f.del(`/trabajadores/${t.id}`);
    expect(del.status).toBe(409);
    expect((await f.put(`/trabajadores/${t.id}`, { estado: 'inactivo' })).status).toBe(200);
    expect((await f.post('/jornales', { trabajador_id: t.id, fecha: D(-2), jornadas: 1 })).status).toBe(422);     // inactivo no recibe jornales
  });
  it('filtros por fechas y trabajadores en jornales', async () => {
    const f = await nuevaFinca(); const a = (await f.post('/trabajadores', { nombre: 'A', tarifa_jornal: 100 })).body.data; const b = (await f.post('/trabajadores', { nombre: 'B', tarifa_jornal: 50 })).body.data;
    await f.post('/jornales', { trabajador_id: a.id, fecha: D(-10), jornadas: 1 }); await f.post('/jornales', { trabajador_id: a.id, fecha: D(-2), jornadas: 1 }); await f.post('/jornales', { trabajador_id: b.id, fecha: D(-2), jornadas: 1 });
    const r = (await f.get(`/jornales?desde=${D(-5)}&hasta=${D(0)}`)).body;
    expect(r.meta.total).toBe(2); expect(r.meta.totales.monto).toBe(150);
    expect((await f.get(`/jornales?trabajador_id=${a.id}`)).body.meta.totales.monto).toBe(200);
  });
});
