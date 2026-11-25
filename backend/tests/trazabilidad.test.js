import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, nuevaFinca, escenarioCampo, cosechaComercializable, D } from './helpers.js';

describe('M2 · Trazabilidad y ficha pública', () => {
  async function conVenta() {
    const f = await nuevaFinca('Finca Secreta SRL');
    const { lote } = await escenarioCampo(f);
    const trab = (await f.post('/trabajadores', { nombre: 'Trabajador Privado Pérez', documento: '99887766' })).body.data;
    await f.post('/labores', { lote_id: lote.id, tipo: 'Deshierbe', fecha_programada: D(-20), estado: 'completada', responsable_id: trab.id, observaciones: 'nota interna confidencial' });
    await f.post('/aplicaciones', { lote_id: lote.id, producto_nombre: 'Fungicida Z', motivo: 'Hongos', fecha_aplicacion: D(-15), periodo_carencia_dias: 5, cantidad_usada: 0, dosis_registrada: 'DOSIS-INTERNA', responsable_id: trab.id });
    const cos = await cosechaComercializable(f, lote.id, 80, D(-5));
    const prod = (await f.get('/productos?categoria=productos_cosechados')).body.data[0];
    await f.put(`/productos/${prod.id}`, { precio_venta: 9 });
    const cli = (await f.post('/clientes', { nombre: 'Cliente Confidencial SA', telefono: '71234567' })).body.data;
    await f.post('/ventas', { cliente_id: cli.id, items: [{ producto_id: prod.id, cantidad: 30 }] });
    return { f, cos, codigo: cos.codigo_lote_cosecha };
  }

  it('la ficha pública NO expone trabajadores, clientes, costos, dosis, observaciones ni ids internos', async () => {
    const { codigo } = await conVenta();
    const r = await request(app).get(`/api/public/trazabilidad/${codigo}`);       // sin autenticación
    expect(r.status).toBe(200);
    const txt = JSON.stringify(r.body);
    for (const secreto of ['Privado', 'Pérez', '99887766', 'Confidencial', '71234567', 'DOSIS-INTERNA', 'nota interna', 'precio', 'costo', 'responsable', 'telefono', 'cliente']) expect(txt.toLowerCase()).not.toContain(secreto.toLowerCase());
    expect(r.body.data.cultivo.nombre).toBe('Tomate');
    expect(r.body.data.labores[0]).toEqual({ tipo: 'Deshierbe', fecha: D(-20) });
    expect(r.body.data.aplicaciones[0]).toMatchObject({ producto: 'Fungicida Z', carencia_dias: 5, fin_carencia: D(-10) });
    expect(r.body.data.comercializable).toBe(true); expect(r.body.data.carencia.cumple).toBe(true);
    expect(r.body.data.comercializacion).toMatchObject({ vendido: 30, ventas: 1 });
    expect(r.body.data.finca.nombre).toBe('Finca Secreta SRL');
  });
  it('la vista interna sí muestra responsables, cliente y toda la cadena lote→…→cliente', async () => {
    const { f, codigo } = await conVenta();
    const t = (await f.get(`/trazabilidad/lotes/${codigo}`)).body.data;
    expect(t.labores[0].responsable).toBe('Trabajador Privado Pérez');
    expect(t.ventas[0].cliente).toBe('Cliente Confidencial SA');
    expect(t.inventario).toMatchObject({ ingresado: 80, stock_actual: 50 });
    expect(t.linea_tiempo.map(e => e.etapa)).toEqual(['cultivo', 'labor', 'aplicacion', 'cosecha', 'inventario', 'venta']);
  });
  it('códigos inexistentes o con formato inválido devuelven 404 (sin filtrar información)', async () => {
    expect((await request(app).get('/api/public/trazabilidad/LC-20260101-ABC123')).status).toBe(404);
    expect((await request(app).get('/api/public/trazabilidad/cualquier-cosa')).status).toBe(404);
    expect((await request(app).get("/api/public/trazabilidad/LC-1' OR 1=1--")).status).toBe(404);
  });
  it('un lote con carencia incumplida figura como NO comercializable en la ficha pública', async () => {
    const f = await nuevaFinca(); const { lote } = await escenarioCampo(f);
    await f.post('/aplicaciones', { lote_id: lote.id, producto_nombre: 'Q', motivo: 'm', fecha_aplicacion: D(-1), periodo_carencia_dias: 10 });
    const cos = (await f.post('/cosechas', { lote_id: lote.id, fecha: D(0), cantidad: 20 })).body.data;
    const r = await request(app).get(`/api/public/trazabilidad/${cos.codigo_lote_cosecha}`);
    expect(r.body.data.comercializable).toBe(false); expect(r.body.data.carencia.cumple).toBe(false);
  });
  it('el QR público es un PNG real que apunta a la ficha; un finca ajena no accede a la vista interna', async () => {
    const { codigo } = await conVenta(); const otra = await nuevaFinca();
    const png = await request(app).get(`/api/public/trazabilidad/${codigo}/qr.png`).buffer(true).parse((res, cb) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(png.headers['content-type']).toBe('image/png'); expect(png.body.length).toBeGreaterThan(500);
    expect((await otra.get(`/trazabilidad/lotes/${codigo}`)).status).toBe(404);
    expect((await otra.get(`/trazabilidad/lotes/${codigo}/qr`)).status).toBe(404);
  });
  it('buscar acepta el código o la URL completa leída de un QR', async () => {
    const { f, codigo } = await conVenta();
    expect((await f.get(`/trazabilidad/buscar/${codigo}`)).status).toBe(200);
    expect((await f.get(`/trazabilidad/buscar/${encodeURIComponent('http://localhost:5173/t/' + codigo)}`)).status).toBe(200);
    expect((await f.get('/trazabilidad/buscar/xyz')).status).toBe(404);
  });
  it('los códigos de lote de cosecha son únicos', async () => {
    const f = await nuevaFinca(); const { lote } = await escenarioCampo(f);
    const codes = new Set();
    for (let i = 0; i < 15; i++) codes.add((await f.post('/cosechas', { lote_id: lote.id, fecha: D(-1), cantidad: 1 })).body.data.codigo_lote_cosecha);
    expect(codes.size).toBe(15);
  });
  it('listado de lotes trazables con stock y vendido', async () => {
    const { f } = await conVenta();
    const l = (await f.get('/trazabilidad/lotes')).body.data[0];
    expect(l).toMatchObject({ cantidad: 80, stock: 50, vendido: 30 });
  });
});
