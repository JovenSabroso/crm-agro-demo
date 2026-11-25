import { describe, it, expect, beforeEach } from 'vitest';
import { nuevaFinca, escenarioCampo, cosechaComercializable, D } from './helpers.js';

let f, prodId, cli, lote;
beforeEach(async () => {
  f = await nuevaFinca();
  ({ lote } = await escenarioCampo(f));
  await cosechaComercializable(f, lote.id, 100, D(-5));                 // lote A: 100 kg (más antiguo)
  await cosechaComercializable(f, lote.id, 60, D(-2));                  // lote B: 60 kg
  prodId = (await f.get('/productos?categoria=productos_cosechados')).body.data[0].id;
  await f.put(`/productos/${prodId}`, { precio_venta: 10 });
  cli = (await f.post('/clientes', { nombre: 'Cliente 1' })).body.data;
});
const vender = (items, extra = {}) => f.post('/ventas', { cliente_id: cli.id, items, ...extra });
const stock = async () => (await f.get(`/productos/${prodId}`)).body.data.stock_actual;

describe('M5 · Ventas y clientes', () => {
  it('calcula subtotales, descuentos y total; actualiza inventario', async () => {
    const r = await vender([{ producto_id: prodId, cantidad: 30, precio_unitario: 12, descuento: 10 }]);
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ subtotal: 360, descuento: 10, total: 350, estado: 'confirmada', numero: 'V-000001' });
    expect(r.body.data.detalle[0].subtotal).toBe(350);
    expect(await stock()).toBe(130);
  });
  it('asigna lotes de cosecha FIFO y divide la línea cuando hace falta (trazabilidad por lote)', async () => {
    const r = await vender([{ producto_id: prodId, cantidad: 120, descuento: 30 }]);
    expect(r.status).toBe(201);
    const det = r.body.data.detalle;
    expect(det).toHaveLength(2);
    expect(det[0].cantidad).toBe(100); expect(det[1].cantidad).toBe(20);
    expect(det[0].lote_cosecha_codigo).not.toBe(det[1].lote_cosecha_codigo);
    expect(det.reduce((s, d) => s + d.descuento, 0)).toBeCloseTo(30, 2);          // el descuento se reparte sin perder centavos
    expect(r.body.data.total).toBe(1170);
    expect(await stock()).toBe(40);
  });
  it('rechaza vender más de lo disponible sin modificar nada (atomicidad)', async () => {
    const r = await vender([{ producto_id: prodId, cantidad: 100 }, { producto_id: prodId, cantidad: 80 }]);
    expect(r.status).toBe(422); expect(r.body.error.message).toMatch(/insuficiente/i);
    expect(await stock()).toBe(160);
    expect((await f.get('/ventas')).body.meta.total).toBe(0);
    expect((await f.get('/cuentas-por-cobrar')).body.meta.total).toBe(0);
  });
  it('no vende lotes no comercializables ni con carencia incumplida', async () => {
    const noComerc = (await f.post('/cosechas', { lote_id: lote.id, fecha: D(-1), cantidad: 50, ingresar_inventario: true })).body.data;   // sin liberar
    const r = await vender([{ producto_id: prodId, cantidad: 10, lote_cosecha_id: noComerc.lote_cosecha_id }]);
    expect(r.status).toBe(422); expect(r.body.error.message).toMatch(/comercializable/i);
    // El FIFO automático ignora lotes retenidos: solo hay 160 kg vendibles
    expect((await vender([{ producto_id: prodId, cantidad: 170 }])).status).toBe(422);
  });
  it('valida entradas: sin ítems, cantidad ≤ 0, descuento mayor al importe, cliente ajeno', async () => {
    expect((await vender([])).status).toBe(400);
    expect((await vender([{ producto_id: prodId, cantidad: 0 }])).status).toBe(400);
    expect((await vender([{ producto_id: prodId, cantidad: 1, descuento: 999 }])).status).toBe(422);
    expect((await vender([{ cantidad: 1 }])).status).toBe(400);
    const otra = await nuevaFinca(); const cliAjeno = (await otra.post('/clientes', { nombre: 'Ajeno' })).body.data;
    expect((await f.post('/ventas', { cliente_id: cliAjeno.id, items: [{ producto_id: prodId, cantidad: 1 }] })).status).toBe(400);
    expect(await stock()).toBe(160);
  });
  it('efectivo paga completo; crédito genera cuenta por cobrar y los pagos la reducen hasta saldarla', async () => {
    const cash = await vender([{ producto_id: prodId, cantidad: 10 }]);
    expect(cash.body.data.saldo).toBe(0); expect(cash.body.data.estado_cobro).toBe('pagada');
    const cr = await vender([{ producto_id: prodId, cantidad: 20 }], { metodo_pago: 'credito', fecha_vencimiento: D(15), monto_pagado: 50 });
    expect(cr.body.data.total).toBe(200); expect(cr.body.data.saldo).toBe(150); expect(cr.body.data.estado_cobro).toBe('parcial');
    const id = cr.body.data.id;
    expect((await f.get('/cuentas-por-cobrar')).body.meta.saldo_total).toBe(150);
    expect((await f.post(`/ventas/${id}/pagos`, { monto: 200 })).status).toBe(422);          // excede el saldo
    const p = await f.post(`/ventas/${id}/pagos`, { monto: 100, metodo: 'transferencia' });
    expect(p.body.data.saldo).toBe(50);
    const fin = await f.post(`/ventas/${id}/pagos`, { monto: 50 });
    expect(fin.body.data.estado).toBe('pagada');
    expect((await f.post(`/ventas/${id}/pagos`, { monto: 1 })).status).toBe(422);
    const hist = (await f.get('/ventas/transacciones')).body.data;
    expect(hist.filter(t => t.venta_id === id).reduce((s, t) => s + t.monto, 0)).toBe(200);
    expect((await f.get('/cuentas-por-cobrar')).body.meta.total).toBe(0);
  });
  it('pago inicial mayor al total se rechaza', async () => {
    expect((await vender([{ producto_id: prodId, cantidad: 1 }], { metodo_pago: 'credito', monto_pagado: 99999 })).status).toBe(422);
    expect(await stock()).toBe(160);
  });
  it('anular una venta restituye el inventario y cancela la cuenta por cobrar', async () => {
    const r = await vender([{ producto_id: prodId, cantidad: 70 }], { metodo_pago: 'credito' });
    expect(await stock()).toBe(90);
    const an = await f.post(`/ventas/${r.body.data.id}/anular`, { motivo: 'Error de digitación' });
    expect(an.status).toBe(200); expect(an.body.data.venta.estado).toBe('anulada');
    expect(await stock()).toBe(160);
    expect((await f.post(`/ventas/${r.body.data.id}/anular`, { motivo: 'otra vez' })).status).toBe(422);
    expect((await f.get('/cuentas-por-cobrar')).body.meta.total).toBe(0);
    const disp = (await f.get('/inventario/disponibilidad')).body.data[0];
    expect(disp.lotes.map(l => l.disponible).sort((x, y) => x - y)).toEqual([60, 100]);                   // cada lote recuperó su cantidad
    expect((await f.post(`/ventas/${r.body.data.id}/pagos`, { monto: 5 })).status).toBe(422);
    // anulada: no cuenta como ingreso
    expect((await f.get('/finanzas/resumen')).body.data.resumen.ingresos.ventas).toBe(0);
  });
  it('borrador no toca inventario hasta confirmarse', async () => {
    const r = await vender([{ producto_id: prodId, cantidad: 10 }], { confirmar: false });
    expect(r.body.data.estado).toBe('borrador'); expect(await stock()).toBe(160);
    expect((await f.get('/cuentas-por-cobrar')).body.meta.total).toBe(0);
    const c = await f.post(`/ventas/${r.body.data.id}/confirmar`, {});
    expect(c.body.data.estado).toBe('confirmada'); expect(await stock()).toBe(150);
    expect((await f.post(`/ventas/${r.body.data.id}/confirmar`, {})).status).toBe(422);    // sin doble descuento
    expect(await stock()).toBe(150);
    expect((await f.del(`/ventas/${r.body.data.id}`)).status).toBe(422);                   // las confirmadas no se borran
  });
  it('numeración correlativa y comprobante PDF imprimible', async () => {
    const a = await vender([{ producto_id: prodId, cantidad: 1 }]); const b = await vender([{ producto_id: prodId, cantidad: 1 }]);
    expect([a.body.data.numero, b.body.data.numero]).toEqual(['V-000001', 'V-000002']);
    const pdf = await f.get(`/ventas/${a.body.data.id}/comprobante.pdf`).buffer(true).parse((res, cb) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('pedido → venta: convierte con lotes FIFO y marca el pedido', async () => {
    const ped = await f.post('/pedidos', { cliente_id: cli.id, items: [{ producto_id: prodId, cantidad: 25 }] });
    expect(ped.status).toBe(201); expect(ped.body.data.total).toBe(250);
    const v = await f.post(`/pedidos/${ped.body.data.id}/convertir`, { metodo_pago: 'qr' });
    expect(v.status).toBe(201); expect(v.body.data.total).toBe(250);
    expect((await f.get(`/pedidos/${ped.body.data.id}`)).body.data.estado).toBe('convertido');
    expect((await f.post(`/pedidos/${ped.body.data.id}/convertir`, {})).status).toBe(422);
    expect(await stock()).toBe(135);
  });
  it('historial del cliente y listados con filtros', async () => {
    await vender([{ producto_id: prodId, cantidad: 10 }]); await vender([{ producto_id: prodId, cantidad: 5 }], { metodo_pago: 'credito' });
    const h = (await f.get(`/clientes/${cli.id}/historial`)).body.data;
    expect(h.ventas).toHaveLength(2); expect(h.total_comprado).toBe(150); expect(h.saldo_pendiente).toBe(50);
    expect((await f.get('/ventas?metodo_pago=credito')).body.meta.total).toBe(1);
    expect((await f.get('/ventas?q=V-000002')).body.meta.total).toBe(1);
    expect((await f.get(`/ventas?desde=${D(1)}`)).body.meta.total).toBe(0);
    expect((await f.get('/clientes?q=Cliente')).body.data[0].compras).toBe(2);
  });
});
