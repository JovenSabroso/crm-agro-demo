import { createApi, Page } from '../core/api.js';
import { crud, assertOwned } from '../core/crud.js';
import { z, str, optStr, optNum, optInt, optDate, date, id, optId, enm, bool, listQuery } from '../core/schemas.js';
import { db, tx } from '../db/index.js';
import { notFound, unprocessable, badRequest } from '../core/errors.js';
import { audit } from '../core/audit.js';
import { today, round2, pad } from '../core/utils.js';
import { moverStock } from './inventario.service.js';
import { SIEMBRA_STATS_SQL, estadoSiembra } from './vivero.service.js';
import { crearVenta } from './ventas.service.js';
import { getVenta, ventaBody } from './ventas.js';

const M = 'M6';

export const viveros = createApi('M6 · Vivero', { prefix: '/viveros', module: M });
crud(viveros, { name: 'vivero', table: 'viveros', perm: 'vivero', create: z.object({ nombre: str(100), ubicacion: optStr(200) }), search: ['x.nombre'], sorts: { nombre: 'x.nombre' }, defaultSort: 'nombre ASC' });

export const especies = createApi('M6 · Especies', { prefix: '/especies', module: M });
crud(especies, {
  name: 'especie', table: 'especies', perm: 'vivero',
  create: z.object({ nombre: str(100), variedad: optStr(100), tipo: optStr(40), dias_germinacion: optInt({ min: 1 }), precio_plantin: optNum({ min: 0 }) }),
  search: ['x.nombre', 'x.variedad'], sorts: { nombre: 'x.nombre' }, defaultSort: 'nombre ASC',
});

export const siembras = createApi('M6 · Siembras y plantines', { prefix: '/vivero', module: M });
const S_FROM = 'siembras_vivero s JOIN viveros v ON v.id = s.vivero_id JOIN especies e ON e.id = s.especie_id';
const costoSql = `ROUND(COALESCE((SELECT SUM(g.monto) FROM gastos g WHERE g.siembra_id = s.id),0)
  + COALESCE((SELECT SUM(m.cantidad * m.costo_unitario) FROM movimientos_inventario m WHERE m.referencia_tipo='siembra' AND m.referencia_id = s.id AND m.tipo='salida'),0), 2)`;
const S_SEL = `s.*, v.nombre vivero_nombre, e.nombre especie_nombre, e.variedad especie_variedad, e.precio_plantin, ${SIEMBRA_STATS_SQL}, ${costoSql} AS costo_produccion`;
const withDerived = (r) => { const existentes = r.germinadas - r.perdidas; const disponibles = existentes - r.vendidas - r.trasplantadas;
  return { ...r, existentes, disponibles, tasa_germinacion: r.cantidad_sembrada ? Math.round(r.germinadas / r.cantidad_sembrada * 1000) / 10 : 0, costo_unitario: r.germinadas > 0 ? round2(r.costo_produccion / r.germinadas) : null }; };
const getSiembra = (sid, fincaId) => { const r = db.prepare(`SELECT ${S_SEL} FROM ${S_FROM} WHERE s.id=? AND s.finca_id=?`).get(sid, fincaId); return r ? withDerived(r) : null; };

siembras.get('/siembras', { summary: 'Listar siembras con plantines existentes, disponibles, vendidos y costos', perm: 'vivero:read', query: listQuery }, (req) => {
  const q = req.q; const where = ['s.finca_id = ?']; const args = [req.user.fincaId];
  for (const k of ['estado', 'vivero_id', 'especie_id']) if (q[k]) { where.push(`s.${k} = ?`); args.push(q[k]); }
  if (q.q) { where.push('(e.nombre LIKE ? OR s.codigo LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
  if (q.desde) { where.push('s.fecha_siembra >= ?'); args.push(q.desde); } if (q.hasta) { where.push('s.fecha_siembra <= ?'); args.push(q.hasta); }
  const total = db.prepare(`SELECT COUNT(*) c FROM ${S_FROM} WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`SELECT ${S_SEL} FROM ${S_FROM} WHERE ${where.join(' AND ')} ORDER BY s.fecha_siembra DESC, s.id DESC LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize).map(withDerived);
  return new Page(rows, { page: q.page, pageSize: q.pageSize, total });
});
siembras.get('/siembras/:id', { summary: 'Detalle de siembra con historial de movimientos', perm: 'vivero:read' }, (req) => {
  const s = getSiembra(Number(req.params.id), req.user.fincaId);
  if (!s) throw notFound('Siembra no encontrada');
  return { ...s, movimientos: db.prepare('SELECT * FROM movimientos_vivero WHERE siembra_id=? ORDER BY fecha DESC, id DESC').all(s.id),
    gastos: db.prepare('SELECT * FROM gastos WHERE siembra_id=? ORDER BY fecha DESC').all(s.id) };
});
siembras.post('/siembras', {
  summary: 'Registrar siembra en vivero (puede descontar semillas/insumos del inventario)', perm: 'vivero:write',
  body: z.object({ vivero_id: id(), especie_id: id(), codigo: optStr(30), fecha_siembra: date(), cantidad_sembrada: z.coerce.number().int().gt(0), observaciones: optStr(300),
    insumos: z.array(z.object({ producto_id: id(), cantidad: z.coerce.number().gt(0) })).max(20).optional() }),
}, (req) => tx(() => {
  const b = req.body; const f = req.user.fincaId;
  assertOwned('viveros', b.vivero_id, f, 'vivero_id'); assertOwned('especies', b.especie_id, f, 'especie_id');
  const n = db.prepare('SELECT COUNT(*) c FROM siembras_vivero WHERE finca_id=?').get(f).c;
  const codigo = b.codigo || `SV-${pad(n + 1, 4)}`;
  const info = db.prepare('INSERT INTO siembras_vivero (finca_id, vivero_id, especie_id, codigo, fecha_siembra, cantidad_sembrada, observaciones) VALUES (?,?,?,?,?,?,?)').run(f, b.vivero_id, b.especie_id, codigo, b.fecha_siembra, b.cantidad_sembrada, b.observaciones ?? null);
  for (const ins of b.insumos ?? []) moverStock({ fincaId: f, productoId: ins.producto_id, tipo: 'salida', motivo: 'consumo', cantidad: ins.cantidad, fecha: b.fecha_siembra, referenciaTipo: 'siembra', referenciaId: info.lastInsertRowid, usuarioId: req.user.id, observaciones: `Siembra de vivero ${codigo}` });
  audit(req, { accion: 'crear', entidad: 'siembras_vivero', id: info.lastInsertRowid, detalle: { codigo, cantidad: b.cantidad_sembrada } });
  return getSiembra(info.lastInsertRowid, f);
}));
siembras.put('/siembras/:id', { summary: 'Editar siembra', perm: 'vivero:write', body: z.object({ observaciones: optStr(300), estado: enm(['en_proceso', 'disponible', 'agotada', 'cerrada']) }).partial() }, (req) => {
  const s = db.prepare('SELECT id FROM siembras_vivero WHERE id=? AND finca_id=?').get(Number(req.params.id), req.user.fincaId);
  if (!s) throw notFound('Siembra no encontrada');
  const keys = Object.keys(req.body).filter(k => req.body[k] !== undefined);
  if (keys.length) db.prepare(`UPDATE siembras_vivero SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map(k => req.body[k]), s.id);
  return getSiembra(s.id, req.user.fincaId);
});
siembras.delete('/siembras/:id', { summary: 'Eliminar siembra sin ventas', perm: 'vivero:write' }, (req) => {
  const s = getSiembra(Number(req.params.id), req.user.fincaId);
  if (!s) throw notFound('Siembra no encontrada');
  if (db.prepare('SELECT 1 FROM detalle_venta WHERE siembra_id=?').get(s.id)) throw unprocessable('La siembra tiene ventas asociadas y no puede eliminarse');
  db.prepare('DELETE FROM siembras_vivero WHERE id=?').run(s.id);
  audit(req, { accion: 'eliminar', entidad: 'siembras_vivero', id: s.id });
  return { eliminado: true };
});

siembras.post('/siembras/:id/movimientos', {
  summary: 'Registrar germinación, crecimiento, pérdida o trasplante', perm: 'vivero:write',
  body: z.object({ tipo: enm(['germinacion', 'perdida', 'trasplante', 'crecimiento']), cantidad: z.coerce.number().int().min(0).default(0), fecha: optDate(), altura_cm: optNum({ min: 0 }), observaciones: optStr(300) }),
}, (req) => tx(() => {
  const s = db.prepare('SELECT * FROM siembras_vivero WHERE id=? AND finca_id=?').get(Number(req.params.id), req.user.fincaId);
  if (!s) throw notFound('Siembra no encontrada');
  const b = req.body; const st = estadoSiembra(s.id);
  if (b.tipo !== 'crecimiento' && b.cantidad <= 0) throw badRequest('La cantidad debe ser mayor que cero');
  if (b.tipo === 'crecimiento' && b.altura_cm == null) throw badRequest('Indica la altura (cm) para el control de crecimiento');
  if (b.tipo === 'germinacion' && st.germinadas + b.cantidad > s.cantidad_sembrada) throw unprocessable(`La germinación acumulada (${st.germinadas + b.cantidad}) excedería lo sembrado (${s.cantidad_sembrada})`);
  if (['perdida', 'trasplante'].includes(b.tipo) && b.cantidad > st.disponibles) throw unprocessable(`Solo hay ${st.disponibles} plantines disponibles`);
  const info = db.prepare('INSERT INTO movimientos_vivero (finca_id, siembra_id, tipo, cantidad, fecha, altura_cm, observaciones) VALUES (?,?,?,?,?,?,?)').run(req.user.fincaId, s.id, b.tipo, b.cantidad, b.fecha || today(), b.altura_cm ?? null, b.observaciones ?? null);
  const after = estadoSiembra(s.id);
  if (after.disponibles <= 0 && after.germinadas > 0 && s.estado !== 'cerrada') db.prepare("UPDATE siembras_vivero SET estado='agotada' WHERE id=?").run(s.id);
  else if (after.disponibles > 0 && ['en_proceso', 'agotada'].includes(s.estado) && after.germinadas > 0) db.prepare("UPDATE siembras_vivero SET estado='disponible' WHERE id=?").run(s.id);
  audit(req, { accion: `vivero_${b.tipo}`, entidad: 'movimientos_vivero', id: info.lastInsertRowid, detalle: { siembra: s.codigo, cantidad: b.cantidad } });
  return { movimiento: db.prepare('SELECT * FROM movimientos_vivero WHERE id=?').get(info.lastInsertRowid), siembra: getSiembra(s.id, req.user.fincaId) };
}));
siembras.get('/movimientos', { summary: 'Historial de producción del vivero', perm: 'vivero:read', query: listQuery }, (req) => {
  const q = req.q; const where = ['m.finca_id = ?']; const args = [req.user.fincaId];
  if (q.siembra_id) { where.push('m.siembra_id = ?'); args.push(q.siembra_id); } if (q.tipo) { where.push('m.tipo = ?'); args.push(q.tipo); }
  if (q.desde) { where.push('m.fecha >= ?'); args.push(q.desde); } if (q.hasta) { where.push('m.fecha <= ?'); args.push(q.hasta); }
  const from = 'movimientos_vivero m JOIN siembras_vivero s ON s.id=m.siembra_id JOIN especies e ON e.id=s.especie_id';
  const total = db.prepare(`SELECT COUNT(*) c FROM ${from} WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`SELECT m.*, s.codigo siembra_codigo, e.nombre especie_nombre FROM ${from} WHERE ${where.join(' AND ')} ORDER BY m.fecha DESC, m.id DESC LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize);
  return new Page(rows, { page: q.page, pageSize: q.pageSize, total });
});
siembras.post('/siembras/:id/costos', { summary: 'Registrar un costo de producción de la siembra', perm: 'vivero:write', body: z.object({ fecha: date(), descripcion: str(200), monto: z.coerce.number().gt(0) }) }, (req) => {
  const s = db.prepare('SELECT id FROM siembras_vivero WHERE id=? AND finca_id=?').get(Number(req.params.id), req.user.fincaId);
  if (!s) throw notFound('Siembra no encontrada');
  const info = db.prepare("INSERT INTO gastos (finca_id, fecha, categoria, descripcion, monto, siembra_id) VALUES (?,?,'vivero',?,?,?)").run(req.user.fincaId, req.body.fecha, req.body.descripcion, round2(req.body.monto), s.id);
  audit(req, { accion: 'costo_vivero', entidad: 'gastos', id: info.lastInsertRowid, detalle: req.body });
  return getSiembra(s.id, req.user.fincaId);
});
siembras.post('/siembras/:id/vender', {
  summary: 'Registrar venta de plantines (crea una venta con trazabilidad y descuenta el stock del vivero)', perm: 'ventas:write', module: 'M5',
  body: z.object({ cliente_id: id(), cantidad: z.coerce.number().int().gt(0), precio_unitario: optNum({ min: 0 }), descuento: optNum({ min: 0 }), metodo_pago: ventaBody.shape.metodo_pago, monto_pagado: optNum({ min: 0 }), fecha: optDate(), fecha_vencimiento: optDate() }),
}, (req) => {
  const s = db.prepare('SELECT id FROM siembras_vivero WHERE id=? AND finca_id=?').get(Number(req.params.id), req.user.fincaId);
  if (!s) throw notFound('Siembra no encontrada');
  const b = req.body;
  const vid = crearVenta({ cliente_id: b.cliente_id, fecha: b.fecha, metodo_pago: b.metodo_pago, monto_pagado: b.monto_pagado, fecha_vencimiento: b.fecha_vencimiento, confirmar: true, items: [{ siembra_id: s.id, cantidad: b.cantidad, precio_unitario: b.precio_unitario, descuento: b.descuento }] }, req);
  return { venta: getVenta(vid, req.user.fincaId), siembra: getSiembra(s.id, req.user.fincaId) };
});
siembras.get('/resumen', { summary: 'Resumen del vivero: producidos, perdidos, vendidos, disponibles y costos', perm: 'vivero:read' }, (req) => {
  const rows = db.prepare(`SELECT ${S_SEL} FROM ${S_FROM} WHERE s.finca_id=?`).all(req.user.fincaId).map(withDerived);
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const ing = db.prepare(`SELECT COALESCE(SUM(d.subtotal),0) s FROM detalle_venta d JOIN ventas v ON v.id=d.venta_id WHERE d.siembra_id IS NOT NULL AND v.estado='confirmada' AND v.finca_id=?`).get(req.user.fincaId).s;
  return { siembras: rows.length, sembradas: sum('cantidad_sembrada'), germinadas: sum('germinadas'), perdidas: sum('perdidas'), vendidas: sum('vendidas'), trasplantadas: sum('trasplantadas'), existentes: sum('existentes'), disponibles: sum('disponibles'),
    costo_produccion: round2(sum('costo_produccion')), ingresos: round2(ing), por_especie: Object.values(rows.reduce((a, r) => { (a[r.especie_nombre] ??= { especie: r.especie_nombre, disponibles: 0, vendidas: 0 }); a[r.especie_nombre].disponibles += r.disponibles; a[r.especie_nombre].vendidas += r.vendidas; return a; }, {})) };
});
