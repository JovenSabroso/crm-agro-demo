import PDFDocument from 'pdfkit';
import { createApi, Page } from '../core/api.js';
import { crud, assertOwned } from '../core/crud.js';
import { z, str, optStr, optNum, optDate, date, id, optId, enm, bool, listQuery, optEmail } from '../core/schemas.js';
import { db, tx } from '../db/index.js';
import { notFound, unprocessable } from '../core/errors.js';
import { audit } from '../core/audit.js';
import { today, round2 } from '../core/utils.js';
import { crearVenta, confirmarVenta, anularVenta, registrarPago } from './ventas.service.js';

const M = 'M5';

// ---------- Clientes ----------
export const clientes = createApi('M5 · Clientes', { prefix: '/clientes', module: M });
crud(clientes, {
  name: 'cliente', table: 'clientes', perm: 'ventas',
  create: z.object({ nombre: str(120), documento: optStr(30), telefono: optStr(30), email: optEmail(), direccion: optStr(200), consentimiento_contacto: bool().default(0), notas: optStr(300) }),
  select: `(SELECT COUNT(*) FROM ventas v WHERE v.cliente_id = x.id AND v.estado = 'confirmada') AS compras,
    (SELECT COALESCE(SUM(saldo),0) FROM cuentas_por_cobrar c WHERE c.cliente_id = x.id AND c.estado IN ('pendiente','parcial')) AS saldo_pendiente`,
  search: ['x.nombre', 'x.documento', 'x.telefono', 'x.email'], sorts: { nombre: 'x.nombre', created: 'x.created_at' }, defaultSort: 'nombre ASC',
});
clientes.get('/:id/historial', { summary: 'Historial de compras y saldo de un cliente', perm: 'ventas:read' }, (req) => {
  const c = db.prepare('SELECT * FROM clientes WHERE id=? AND finca_id=?').get(Number(req.params.id), req.user.fincaId);
  if (!c) throw notFound('Cliente no encontrado');
  const ventas = db.prepare(`SELECT v.id, v.numero, v.fecha, v.total, v.estado, v.metodo_pago, cc.saldo FROM ventas v LEFT JOIN cuentas_por_cobrar cc ON cc.venta_id=v.id WHERE v.cliente_id=? ORDER BY v.fecha DESC, v.id DESC`).all(c.id);
  const conf = ventas.filter(v => v.estado === 'confirmada');
  return { cliente: c, ventas, total_comprado: round2(conf.reduce((s, v) => s + v.total, 0)), saldo_pendiente: round2(conf.reduce((s, v) => s + (v.saldo || 0), 0)) };
});

// ---------- Ventas ----------
export const ventas = createApi('M5 · Ventas', { prefix: '/ventas', module: M });
const itemSchema = z.object({ producto_id: optId(), siembra_id: optId(), lote_cosecha_id: optId(), cantidad: z.coerce.number().gt(0, 'La cantidad debe ser mayor que 0'), precio_unitario: optNum({ min: 0 }), descuento: optNum({ min: 0 }) })
  .refine(i => (i.producto_id != null) !== (i.siembra_id != null), { message: 'Cada ítem debe indicar producto_id o siembra_id (uno solo)' });
export const ventaBody = z.object({
  cliente_id: id(), fecha: optDate(), pedido_id: optId(), metodo_pago: enm(['efectivo', 'transferencia', 'qr', 'tarjeta', 'credito']).default('efectivo'),
  fecha_vencimiento: optDate(), monto_pagado: optNum({ min: 0 }), confirmar: z.boolean().default(true), observaciones: optStr(300),
  items: z.array(itemSchema).min(1, 'Agrega al menos un producto').max(100),
});

const V_FROM = 'ventas v JOIN clientes c ON c.id = v.cliente_id LEFT JOIN cuentas_por_cobrar cc ON cc.venta_id = v.id';
const V_SEL = 'v.*, c.nombre AS cliente_nombre, cc.saldo, cc.estado AS estado_cobro, cc.fecha_vencimiento AS vence';
export function getVenta(ventaId, fincaId) {
  const v = db.prepare(`SELECT ${V_SEL} FROM ${V_FROM} WHERE v.id=? AND v.finca_id=?`).get(ventaId, fincaId);
  if (!v) return null;
  const detalle = db.prepare(`SELECT d.*, lc.codigo AS lote_cosecha_codigo, p.unidad FROM detalle_venta d LEFT JOIN lotes_cosecha lc ON lc.id=d.lote_cosecha_id LEFT JOIN productos p ON p.id=d.producto_id WHERE d.venta_id=? ORDER BY d.id`).all(v.id);
  const pagos = db.prepare('SELECT * FROM pagos_venta WHERE venta_id=? ORDER BY fecha, id').all(v.id);
  const cliente = db.prepare('SELECT * FROM clientes WHERE id=?').get(v.cliente_id);
  return { ...v, cliente, detalle, pagos, pagado: round2(pagos.reduce((s, p) => s + p.monto, 0)) };
}

ventas.get('/', { summary: 'Listar ventas', perm: 'ventas:read', query: listQuery }, (req) => {
  const q = req.q; const where = ['v.finca_id = ?']; const args = [req.user.fincaId];
  for (const k of ['cliente_id', 'estado', 'metodo_pago']) if (q[k]) { where.push(`v.${k} = ?`); args.push(q[k]); }
  if (q.estado_cobro) { where.push('cc.estado = ?'); args.push(q.estado_cobro); }
  if (q.q) { where.push('(v.numero LIKE ? OR c.nombre LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
  if (q.desde) { where.push('v.fecha >= ?'); args.push(q.desde); } if (q.hasta) { where.push('v.fecha <= ?'); args.push(q.hasta); }
  const sorts = { fecha: 'v.fecha', total: 'v.total', numero: 'v.numero', cliente: 'c.nombre' };
  const order = `${sorts[q.sort] || 'v.fecha'} ${q.dir === 'asc' ? 'ASC' : 'DESC'}`;
  const total = db.prepare(`SELECT COUNT(*) c FROM ${V_FROM} WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`SELECT ${V_SEL} FROM ${V_FROM} WHERE ${where.join(' AND ')} ORDER BY ${order}, v.id DESC LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize);
  return new Page(rows, { page: q.page, pageSize: q.pageSize, total });
});
ventas.get('/transacciones', { summary: 'Historial de transacciones (cobros registrados)', perm: 'ventas:read', query: listQuery }, (req) => {
  const q = req.q; const where = ['p.finca_id = ?']; const args = [req.user.fincaId];
  if (q.cliente_id) { where.push('v.cliente_id = ?'); args.push(q.cliente_id); }
  if (q.desde) { where.push('p.fecha >= ?'); args.push(q.desde); } if (q.hasta) { where.push('p.fecha <= ?'); args.push(q.hasta); }
  const from = 'pagos_venta p JOIN ventas v ON v.id=p.venta_id JOIN clientes c ON c.id=v.cliente_id';
  const total = db.prepare(`SELECT COUNT(*) c FROM ${from} WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`SELECT p.*, v.numero, v.estado venta_estado, c.nombre cliente_nombre FROM ${from} WHERE ${where.join(' AND ')} ORDER BY p.fecha DESC, p.id DESC LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize);
  return new Page(rows, { page: q.page, pageSize: q.pageSize, total });
});
ventas.get('/:id', { summary: 'Detalle de una venta (líneas, pagos, lotes trazables)', perm: 'ventas:read' }, (req) => {
  const v = getVenta(Number(req.params.id), req.user.fincaId);
  if (!v) throw notFound('Venta no encontrada');
  return v;
});
ventas.post('/', { summary: 'Registrar venta (confirmada por defecto: descuenta inventario, crea cuenta por cobrar y pago inicial)', perm: 'ventas:write', body: ventaBody }, (req) => {
  const vid = crearVenta(req.body, req);
  return getVenta(vid, req.user.fincaId);
});
ventas.post('/:id/confirmar', { summary: 'Confirmar una venta en borrador', perm: 'ventas:write', status: 200, body: z.object({ monto_pagado: optNum({ min: 0 }) }) }, (req) => {
  confirmarVenta(Number(req.params.id), req, { montoPagado: req.body.monto_pagado ?? undefined });
  return getVenta(Number(req.params.id), req.user.fincaId);
});
ventas.post('/:id/anular', { summary: 'Anular una venta (revierte inventario y cuenta por cobrar)', perm: 'ventas:write', status: 200, body: z.object({ motivo: str(200) }) }, (req) => {
  const r = anularVenta(Number(req.params.id), req, req.body.motivo);
  return { ...r, venta: getVenta(Number(req.params.id), req.user.fincaId) };
});
ventas.post('/:id/pagos', { summary: 'Registrar un pago (abono) de la venta', perm: 'ventas:write', body: z.object({ monto: z.coerce.number().gt(0), metodo: optStr(30), fecha: optDate(), referencia: optStr(80) }) }, (req) => {
  const r = registrarPago(Number(req.params.id), req.body, req);
  return { ...r, venta: getVenta(Number(req.params.id), req.user.fincaId) };
});
ventas.delete('/:id', { summary: 'Eliminar una venta en borrador', perm: 'ventas:write' }, (req) => {
  const r = db.prepare("DELETE FROM ventas WHERE id=? AND finca_id=? AND estado='borrador'").run(Number(req.params.id), req.user.fincaId);
  if (!r.changes) throw unprocessable('Solo se pueden eliminar ventas en borrador (las confirmadas se anulan)');
  audit(req, { accion: 'eliminar', entidad: 'ventas', id: req.params.id });
  return { eliminado: true };
});

// Comprobante imprimible (PDF)
ventas.get('/:id/comprobante.pdf', { summary: 'Comprobante de venta imprimible (PDF)', perm: 'ventas:read', raw: true }, (req, res) => {
  const v = getVenta(Number(req.params.id), req.user.fincaId);
  if (!v) throw notFound('Venta no encontrada');
  const f = db.prepare('SELECT * FROM fincas WHERE id=?').get(req.user.fincaId);
  const mon = f.moneda;
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="comprobante-${v.numero}.pdf"` });
  doc.pipe(res);
  doc.fontSize(18).fillColor('#1f5130').text(f.nombre, { continued: false });
  doc.fontSize(9).fillColor('#555').text([f.ubicacion, f.telefono].filter(Boolean).join(' · '));
  doc.moveDown(0.8).fontSize(14).fillColor('#000').text(`COMPROBANTE DE VENTA ${v.numero}`);
  doc.fontSize(10).text(`Fecha: ${v.fecha}    Estado: ${v.estado.toUpperCase()}    Método de pago: ${v.metodo_pago}`);
  doc.text(`Cliente: ${v.cliente_nombre}${v.cliente?.documento ? ' · Doc: ' + v.cliente.documento : ''}`);
  doc.moveDown();
  const x = [48, 290, 350, 420, 490]; let y = doc.y;
  doc.font('Helvetica-Bold').fontSize(9); ['Descripción', 'Cant.', 'P. unit.', 'Desc.', 'Subtotal'].forEach((h, i) => doc.text(h, x[i], y, { width: i === 0 ? 235 : 60 }));
  doc.moveTo(48, y + 13).lineTo(547, y + 13).stroke('#999'); y += 18; doc.font('Helvetica').fontSize(9);
  for (const d of v.detalle) {
    doc.text(d.descripcion, x[0], y, { width: 235 }); const h = doc.heightOfString(d.descripcion, { width: 235 });
    doc.text(String(d.cantidad), x[1], y, { width: 55 }); doc.text(d.precio_unitario.toFixed(2), x[2], y, { width: 65 });
    doc.text(d.descuento.toFixed(2), x[3], y, { width: 65 }); doc.text(d.subtotal.toFixed(2), x[4], y, { width: 57 });
    y += Math.max(h, 12) + 4; if (y > 740) { doc.addPage(); y = 48; }
  }
  doc.moveTo(48, y).lineTo(547, y).stroke('#999'); y += 8;
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text(`Subtotal: ${v.subtotal.toFixed(2)} ${mon}`, 48, y, { align: 'right', width: 499 }); y += 14;
  doc.text(`Descuentos: ${v.descuento.toFixed(2)} ${mon}`, 48, y, { align: 'right', width: 499 }); y += 14;
  doc.fontSize(12).text(`TOTAL: ${v.total.toFixed(2)} ${mon}`, 48, y, { align: 'right', width: 499 }); y += 20;
  doc.font('Helvetica').fontSize(9).text(`Pagado: ${v.pagado.toFixed(2)} ${mon}    Saldo: ${(v.saldo ?? 0).toFixed(2)} ${mon}`, 48, y, { align: 'right', width: 499 });
  const lotes = [...new Set(v.detalle.map(d => d.lote_cosecha_codigo).filter(Boolean))];
  if (lotes.length) { doc.moveDown(2).fontSize(8).fillColor('#555').text(`Lotes de cosecha (trazabilidad): ${lotes.join(', ')}`, 48); }
  doc.end();
});

// ---------- Cuentas por cobrar ----------
export const cxc = createApi('M5 · Cuentas por cobrar', { prefix: '/cuentas-por-cobrar', module: M });
cxc.get('/', { summary: 'Cuentas por cobrar (filtros por estado y cliente)', perm: 'ventas:read', query: listQuery }, (req) => {
  const q = req.q; const where = ['cc.finca_id = ?']; const args = [req.user.fincaId];
  if (q.estado) { where.push('cc.estado = ?'); args.push(q.estado); } else where.push("cc.estado IN ('pendiente','parcial')");
  if (q.cliente_id) { where.push('cc.cliente_id = ?'); args.push(q.cliente_id); }
  if (q.vencidas === '1') where.push("cc.fecha_vencimiento < date('now') AND cc.saldo > 0");
  const from = 'cuentas_por_cobrar cc JOIN ventas v ON v.id=cc.venta_id JOIN clientes c ON c.id=cc.cliente_id';
  const total = db.prepare(`SELECT COUNT(*) c FROM ${from} WHERE ${where.join(' AND ')}`).get(...args).c;
  const tot = db.prepare(`SELECT COALESCE(SUM(cc.saldo),0) s FROM ${from} WHERE ${where.join(' AND ')}`).get(...args).s;
  const rows = db.prepare(`SELECT cc.*, v.numero, v.fecha, c.nombre cliente_nombre, (cc.fecha_vencimiento IS NOT NULL AND cc.fecha_vencimiento < date('now') AND cc.saldo > 0) vencida
    FROM ${from} WHERE ${where.join(' AND ')} ORDER BY COALESCE(cc.fecha_vencimiento, v.fecha), cc.id LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize);
  const p = new Page(rows, { page: q.page, pageSize: q.pageSize, total }); p.meta.saldo_total = round2(tot); return p;
});

// ---------- Pedidos ----------
export const pedidos = createApi('M5 · Pedidos', { prefix: '/pedidos', module: M });
const pedItem = z.object({ producto_id: id(), cantidad: z.coerce.number().gt(0), precio_unitario: optNum({ min: 0 }) });
const getPedido = (pid, fincaId) => {
  const p = db.prepare('SELECT p.*, c.nombre cliente_nombre FROM pedidos p JOIN clientes c ON c.id=p.cliente_id WHERE p.id=? AND p.finca_id=?').get(pid, fincaId);
  if (!p) return null;
  const items = db.prepare('SELECT d.*, pr.nombre producto_nombre, pr.unidad FROM pedido_detalles d JOIN productos pr ON pr.id=d.producto_id WHERE d.pedido_id=?').all(pid);
  return { ...p, items, total: round2(items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0)) };
};
pedidos.get('/', { summary: 'Listar pedidos', perm: 'ventas:read', query: listQuery }, (req) => {
  const q = req.q; const where = ['p.finca_id = ?']; const args = [req.user.fincaId];
  if (q.estado) { where.push('p.estado = ?'); args.push(q.estado); } if (q.cliente_id) { where.push('p.cliente_id = ?'); args.push(q.cliente_id); }
  if (q.q) { where.push('c.nombre LIKE ?'); args.push(`%${q.q}%`); }
  if (q.desde) { where.push('p.fecha >= ?'); args.push(q.desde); } if (q.hasta) { where.push('p.fecha <= ?'); args.push(q.hasta); }
  const from = 'pedidos p JOIN clientes c ON c.id=p.cliente_id';
  const total = db.prepare(`SELECT COUNT(*) c FROM ${from} WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`SELECT p.*, c.nombre cliente_nombre, (SELECT ROUND(SUM(cantidad*precio_unitario),2) FROM pedido_detalles d WHERE d.pedido_id=p.id) total
    FROM ${from} WHERE ${where.join(' AND ')} ORDER BY p.fecha DESC, p.id DESC LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize);
  return new Page(rows, { page: q.page, pageSize: q.pageSize, total });
});
pedidos.get('/:id', { summary: 'Detalle de un pedido', perm: 'ventas:read' }, (req) => { const p = getPedido(Number(req.params.id), req.user.fincaId); if (!p) throw notFound('Pedido no encontrado'); return p; });
pedidos.post('/', { summary: 'Registrar pedido de un cliente', perm: 'ventas:write', body: z.object({ cliente_id: id(), fecha: optDate(), fecha_entrega: optDate(), observaciones: optStr(300), items: z.array(pedItem).min(1).max(100) }) }, (req) => tx(() => {
  const b = req.body; const f = req.user.fincaId;
  assertOwned('clientes', b.cliente_id, f, 'cliente_id');
  const info = db.prepare('INSERT INTO pedidos (finca_id, cliente_id, fecha, fecha_entrega, observaciones) VALUES (?,?,?,?,?)').run(f, b.cliente_id, b.fecha || today(), b.fecha_entrega ?? null, b.observaciones ?? null);
  for (const it of b.items) {
    const p = assertOwned('productos', it.producto_id, f, 'producto_id');
    const precio = it.precio_unitario ?? p.precio_venta; if (precio == null) throw unprocessable(`"${p.nombre}" no tiene precio de venta; indícalo en el pedido`);
    db.prepare('INSERT INTO pedido_detalles (pedido_id, producto_id, cantidad, precio_unitario) VALUES (?,?,?,?)').run(info.lastInsertRowid, p.id, it.cantidad, precio);
  }
  audit(req, { accion: 'crear', entidad: 'pedidos', id: info.lastInsertRowid });
  return getPedido(info.lastInsertRowid, f);
}));
pedidos.patch('/:id/estado', { summary: 'Cambiar estado del pedido (confirmado / cancelado)', perm: 'ventas:write', status: 200, body: z.object({ estado: enm(['pendiente', 'confirmado', 'cancelado']) }) }, (req) => {
  const p = db.prepare('SELECT * FROM pedidos WHERE id=? AND finca_id=?').get(Number(req.params.id), req.user.fincaId);
  if (!p) throw notFound('Pedido no encontrado');
  if (p.estado === 'convertido') throw unprocessable('El pedido ya fue convertido en venta');
  db.prepare('UPDATE pedidos SET estado=? WHERE id=?').run(req.body.estado, p.id);
  audit(req, { accion: 'cambiar_estado', entidad: 'pedidos', id: p.id, detalle: req.body });
  return getPedido(p.id, req.user.fincaId);
});
pedidos.post('/:id/convertir', { summary: 'Convertir el pedido en venta (asigna lotes de cosecha FIFO)', perm: 'ventas:write', body: z.object({ metodo_pago: enm(['efectivo', 'transferencia', 'qr', 'tarjeta', 'credito']).default('efectivo'), fecha_vencimiento: optDate(), monto_pagado: optNum({ min: 0 }), fecha: optDate() }) }, (req) => {
  const p = getPedido(Number(req.params.id), req.user.fincaId);
  if (!p) throw notFound('Pedido no encontrado');
  if (['convertido', 'cancelado'].includes(p.estado)) throw unprocessable(`El pedido está ${p.estado}`);
  const vid = crearVenta({ cliente_id: p.cliente_id, pedido_id: p.id, ...req.body, items: p.items.map(i => ({ producto_id: i.producto_id, cantidad: i.cantidad, precio_unitario: i.precio_unitario })), confirmar: true }, req);
  return getVenta(vid, req.user.fincaId);
});
pedidos.delete('/:id', { summary: 'Eliminar pedido pendiente o cancelado', perm: 'ventas:write' }, (req) => {
  const r = db.prepare("DELETE FROM pedidos WHERE id=? AND finca_id=? AND estado IN ('pendiente','cancelado')").run(Number(req.params.id), req.user.fincaId);
  if (!r.changes) throw unprocessable('Solo se pueden eliminar pedidos pendientes o cancelados');
  audit(req, { accion: 'eliminar', entidad: 'pedidos', id: req.params.id });
  return { eliminado: true };
});
