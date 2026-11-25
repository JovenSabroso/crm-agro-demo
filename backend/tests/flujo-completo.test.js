import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, nuevaFinca, D } from './helpers.js';

/** Flujo de negocio completo exigido: lote → cultivo → labor → cosecha → QR → trazabilidad → inventario → cliente → venta → inventario → historial → finanzas */
describe('Flujo completo del negocio', () => {
  it('recorre los 12 pasos de punta a punta con cifras consistentes', async () => {
    const f = await nuevaFinca('Finca Flujo');

    // 1. Registrar un lote
    const lote = await f.post('/lotes', { codigo: 'L1', nombre: 'Lote Tomates', superficie_ha: 0.8 });
    expect(lote.status).toBe(201);
    // 2. Asociar un cultivo
    const cultivo = (await f.post('/cultivos', { nombre: 'Tomate', variedad: 'Cherry', tipo: 'hortaliza', unidad_cosecha: 'kg' })).body.data;
    const plant = await f.post('/plantaciones', { lote_id: lote.body.data.id, cultivo_id: cultivo.id, fecha_siembra: D(-70), fecha_cosecha_estimada: D(20) });
    expect(plant.status).toBe(201);
    // 3. Registrar una labor
    const labor = await f.post('/labores', { lote_id: lote.body.data.id, tipo: 'Deshierbe', fecha_programada: D(-30), estado: 'completada' });
    expect(labor.status).toBe(201);
    expect(labor.body.data.plantacion_id).toBe(plant.body.data.id);              // se asocia automáticamente a la plantación activa
    expect(labor.body.data.fecha_realizada).toBeTruthy();
    // gasto de jornal imputado al lote (para el resultado financiero)
    const trab = (await f.post('/trabajadores', { nombre: 'Juan', tarifa_jornal: 100 })).body.data;
    expect((await f.post('/jornales', { trabajador_id: trab.id, fecha: D(-20), jornadas: 1, lote_id: lote.body.data.id })).status).toBe(201);

    // 4. Registrar una cosecha (genera lote de cosecha con código único)
    const cos = await f.post('/cosechas', { lote_id: lote.body.data.id, fecha: D(-2), cantidad: 100, comercializable: true });
    expect(cos.status).toBe(201);
    const codigo = cos.body.data.codigo_lote_cosecha;
    expect(codigo).toMatch(/^LC-\d{8}-[A-Z0-9]{6}$/);

    // 5. Generar su QR
    const qr = await f.get(`/trazabilidad/lotes/${codigo}/qr`);
    expect(qr.status).toBe(200);
    expect(qr.body.data.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(qr.body.data.url).toContain(`/t/${codigo}`);
    const png = await f.get(`/trazabilidad/lotes/${codigo}/qr.png`).buffer(true).parse((res, cb) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.body.subarray(0, 4).toString('hex')).toBe('89504e47');            // firma PNG real

    // 6. Consultar su trazabilidad (interna y pública mediante el QR)
    const traza = (await f.get(`/trazabilidad/lotes/${codigo}`)).body.data;
    expect(traza.cultivo.nombre).toBe('Tomate');
    expect(traza.labores.map(l => l.tipo)).toContain('Deshierbe');
    expect(traza.cosecha.cantidad).toBe(100);
    const publica = await request(app).get(`/api/public/trazabilidad/${codigo}`);
    expect(publica.status).toBe(200);
    expect(publica.body.data.cosecha.cantidad).toBe(100);

    // 7. Ingresar la cosecha al inventario
    const ing = await f.post(`/cosechas/${cos.body.data.id}/inventario`, { costo_unitario: 3 });
    expect(ing.status).toBe(201);
    const prodId = ing.body.data.movimiento.producto_id;
    expect((await f.get(`/productos/${prodId}`)).body.data.stock_actual).toBe(100);
    expect((await f.post(`/cosechas/${cos.body.data.id}/inventario`, {})).status).toBe(422);       // no se puede ingresar dos veces

    // 8. Registrar un cliente
    const cli = (await f.post('/clientes', { nombre: 'Mercado Central', telefono: '70000000' })).body.data;
    await f.put(`/productos/${prodId}`, { precio_venta: 10 });

    // 9. Realizar una venta (40 kg, descuento 20)
    const venta = await f.post('/ventas', { cliente_id: cli.id, fecha: D(0), metodo_pago: 'efectivo', items: [{ producto_id: prodId, cantidad: 40, descuento: 20 }] });
    expect(venta.status).toBe(201);
    expect(venta.body.data.total).toBe(380);                                       // 40 × 10 − 20
    expect(venta.body.data.detalle[0].lote_cosecha_codigo).toBe(codigo);           // venta vinculada al lote de cosecha
    expect(venta.body.data.saldo).toBe(0);

    // 10. Actualizar el inventario
    expect((await f.get(`/productos/${prodId}`)).body.data.stock_actual).toBe(60);
    const disp = (await f.get('/inventario/disponibilidad')).body.data.find(p => p.id === prodId);
    expect(disp.lotes[0].disponible).toBe(60);

    // 11. Consultar el historial de trazabilidad (llega hasta la venta y el cliente)
    const traza2 = (await f.get(`/trazabilidad/lotes/${codigo}`)).body.data;
    expect(traza2.ventas).toHaveLength(1);
    expect(traza2.ventas[0].cliente).toBe('Mercado Central');
    expect(traza2.comercializacion.vendido).toBe(40);
    expect(traza2.linea_tiempo.map(e => e.etapa)).toEqual(expect.arrayContaining(['cultivo', 'labor', 'cosecha', 'inventario', 'venta']));
    const inversa = (await f.get(`/trazabilidad/ventas/${venta.body.data.id}`)).body.data;
    expect(inversa[0].codigo).toBe(codigo);

    // 12. Resultado financiero: ingresos 380; costos = jornal 100 → margen 280
    const fin = (await f.get('/finanzas/resumen')).body.data.resumen;
    expect(fin.ingresos.ventas).toBe(380);
    expect(fin.costos.jornales).toBe(100);
    expect(fin.margen_operativo).toBe(280);
    const porLote = (await f.get('/finanzas/por-lote')).body.data[0];
    expect(porLote.codigo).toBe('L1'); expect(porLote.margen).toBe(280); expect(porLote.rentabilidad_pct).toBe(280);
    const porCult = (await f.get('/finanzas/por-cultivo')).body.data[0];
    expect(porCult.nombre).toBe('Tomate Cherry'); expect(porCult.margen).toBe(280);

    // El dashboard refleja los mismos datos reales
    const dash = (await f.get('/dashboard')).body.data;
    expect(dash.kpis.lotes_total).toBe(1);
    expect(dash.kpis.ventas_periodo.total).toBe(380);
    expect(dash.kpis.margen).toBe(280);
    expect(dash.kpis.produccion[0]).toEqual({ unidad: 'kg', cantidad: 100 });
  });
});
