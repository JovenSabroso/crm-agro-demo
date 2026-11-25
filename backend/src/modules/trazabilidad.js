import QRCode from 'qrcode';
import { createApi, Page } from '../core/api.js';
import { listQuery } from '../core/schemas.js';
import { db } from '../db/index.js';
import { config } from '../config/env.js';
import { notFound } from '../core/errors.js';
import { verificarCarencia } from './campo.js';

export const CODE_RE = /^LC-\d{8}-[A-Z0-9]{6}$/;
export const qrUrl = (codigo) => `${config.publicBaseUrl}/t/${codigo}`;

/**
 * Construye la trazabilidad completa: Lote → Cultivo → Labores → Aplicaciones → Cosecha → Inventario → Venta → Cliente.
 * publicView=true devuelve solo lo apto para el consumidor final (sin trabajadores, costos, clientes ni datos internos).
 */
export function construirTrazabilidad(codigo, { fincaId = null, publicView = false } = {}) {
  const lc = db.prepare(`SELECT lc.id, lc.codigo, lc.producto_id, lc.cantidad_inventariada, lc.finca_id, lc.created_at,
      c.id cosecha_id, c.fecha, c.cantidad, c.unidad, c.calidad, c.comercializable, c.observaciones, c.plantacion_id, c.lote_id,
      f.nombre finca_nombre, f.ubicacion finca_ubicacion, lo.codigo lote_codigo, lo.nombre lote_nombre,
      cu.nombre cultivo, cu.variedad, cu.tipo cultivo_tipo, p.fecha_siembra, p.fecha_cosecha_estimada, ca.nombre campana,
      tr.nombre responsable
    FROM lotes_cosecha lc JOIN cosechas c ON c.id = lc.cosecha_id JOIN fincas f ON f.id = lc.finca_id JOIN lotes lo ON lo.id = c.lote_id
      JOIN plantaciones p ON p.id = c.plantacion_id JOIN cultivos cu ON cu.id = p.cultivo_id LEFT JOIN campanas ca ON ca.id = p.campana_id
      LEFT JOIN trabajadores tr ON tr.id = c.responsable_id
    WHERE lc.codigo = ? ${fincaId ? 'AND lc.finca_id = ?' : ''}`).get(...(fincaId ? [codigo, fincaId] : [codigo]));
  if (!lc) throw notFound('Lote de cosecha no encontrado');

  const labores = db.prepare(`SELECT l.id, l.tipo, l.descripcion, COALESCE(l.fecha_realizada, l.fecha_programada) fecha, tr.nombre responsable
    FROM labores l LEFT JOIN trabajadores tr ON tr.id = l.responsable_id
    WHERE l.estado = 'completada' AND (l.plantacion_id = ? OR (l.plantacion_id IS NULL AND l.lote_id = ?)) AND COALESCE(l.fecha_realizada, l.fecha_programada) <= ? ORDER BY fecha`).all(lc.plantacion_id, lc.lote_id, lc.fecha);
  const aplicaciones = db.prepare(`SELECT a.id, a.producto_nombre, a.motivo, a.fecha_aplicacion, a.periodo_carencia_dias, a.fecha_fin_carencia, tr.nombre responsable
    FROM aplicaciones_fito a LEFT JOIN trabajadores tr ON tr.id = a.responsable_id
    WHERE a.estado = 'aplicada' AND (a.plantacion_id = ? OR (a.plantacion_id IS NULL AND a.lote_id = ?)) AND a.fecha_aplicacion <= ? ORDER BY a.fecha_aplicacion`).all(lc.plantacion_id, lc.lote_id, lc.fecha);
  const riegos = db.prepare(`SELECT COUNT(*) total, MIN(fecha) primero, MAX(fecha) ultimo FROM riegos WHERE (plantacion_id = ? OR (plantacion_id IS NULL AND lote_id = ?)) AND fecha <= ?`).get(lc.plantacion_id, lc.lote_id, lc.fecha);
  const incumplidas = verificarCarencia(lc.plantacion_id, lc.lote_id, lc.fecha);

  const ventasRows = db.prepare(`SELECT v.id venta_id, v.numero, v.fecha, d.cantidad, d.precio_unitario, d.subtotal, cl.nombre cliente
    FROM detalle_venta d JOIN ventas v ON v.id = d.venta_id JOIN clientes cl ON cl.id = v.cliente_id
    WHERE d.lote_cosecha_id = ? AND v.estado = 'confirmada' ORDER BY v.fecha, v.id`).all(lc.id);
  const vendido = ventasRows.reduce((s, r) => s + r.cantidad, 0);
  const stock = db.prepare('SELECT COALESCE(SUM(delta),0) s FROM movimientos_inventario WHERE lote_cosecha_id = ?').get(lc.id).s;

  const base = {
    codigo: lc.codigo, url: qrUrl(lc.codigo),
    finca: { nombre: lc.finca_nombre, ubicacion: lc.finca_ubicacion },
    cultivo: { nombre: lc.cultivo, variedad: lc.variedad, tipo: lc.cultivo_tipo },
    siembra: { fecha: lc.fecha_siembra, campana: lc.campana },
    cosecha: { fecha: lc.fecha, cantidad: lc.cantidad, unidad: lc.unidad, calidad: lc.calidad },
    comercializable: !!lc.comercializable && incumplidas.length === 0,
    carencia: { cumple: incumplidas.length === 0, aplicaciones_con_carencia: aplicaciones.filter(a => a.periodo_carencia_dias > 0).length },
    riego: { registros: riegos.total, primero: riegos.primero, ultimo: riegos.ultimo },
    comercializacion: { vendido: Math.round(vendido * 1000) / 1000, unidad: lc.unidad, ventas: ventasRows.length, primera_venta: ventasRows[0]?.fecha ?? null, ultima_venta: ventasRows.at(-1)?.fecha ?? null },
  };

  if (publicView) {
    return {
      ...base,
      lote: { nombre: lc.lote_nombre },
      labores: labores.map(l => ({ tipo: l.tipo, fecha: l.fecha })),
      aplicaciones: aplicaciones.map(a => ({ producto: a.producto_nombre, motivo: a.motivo, fecha: a.fecha_aplicacion, carencia_dias: a.periodo_carencia_dias, fin_carencia: a.fecha_fin_carencia })),
      linea_tiempo: timeline(lc, labores, aplicaciones, [], false),
    };
  }
  const producto = lc.producto_id ? db.prepare('SELECT id, nombre, categoria, unidad FROM productos WHERE id = ?').get(lc.producto_id) : null;
  return {
    ...base,
    lote: { codigo: lc.lote_codigo, nombre: lc.lote_nombre },
    cosecha: { ...base.cosecha, id: lc.cosecha_id, responsable: lc.responsable, observaciones: lc.observaciones },
    carencia: { ...base.carencia, incumplidas },
    labores, aplicaciones,
    inventario: { producto, ingresado: lc.cantidad_inventariada, stock_actual: Math.round(stock * 1000) / 1000 },
    ventas: ventasRows,
    linea_tiempo: timeline(lc, labores, aplicaciones, ventasRows, true),
  };
}

function timeline(lc, labores, aplicaciones, ventas, internal) {
  const ev = [{ fecha: lc.fecha_siembra, etapa: 'cultivo', titulo: `Siembra de ${lc.cultivo}${lc.variedad ? ' ' + lc.variedad : ''}` }];
  labores.forEach(l => ev.push({ fecha: l.fecha, etapa: 'labor', titulo: l.tipo }));
  aplicaciones.forEach(a => ev.push({ fecha: a.fecha_aplicacion, etapa: 'aplicacion', titulo: `Aplicación: ${a.producto_nombre ?? a.producto}`, detalle: a.periodo_carencia_dias ? `Carencia ${a.periodo_carencia_dias} días (hasta ${a.fecha_fin_carencia})` : null }));
  ev.push({ fecha: lc.fecha, etapa: 'cosecha', titulo: `Cosecha: ${lc.cantidad} ${lc.unidad}` });
  if (internal) {
    if (lc.cantidad_inventariada > 0) ev.push({ fecha: lc.fecha, etapa: 'inventario', titulo: `Ingreso al inventario: ${lc.cantidad_inventariada} ${lc.unidad}` });
    ventas.forEach(v => ev.push({ fecha: v.fecha, etapa: 'venta', titulo: `Venta ${v.numero}: ${v.cantidad} ${lc.unidad}`, detalle: `Cliente: ${v.cliente}` }));
  }
  const order = { cultivo: 0, labor: 1, aplicacion: 2, cosecha: 3, inventario: 4, venta: 5 };
  return ev.sort((a, b) => a.fecha.localeCompare(b.fecha) || order[a.etapa] - order[b.etapa]);
}

// ---------- API privada (M2) ----------
export const trazabilidad = createApi('M2 · Trazabilidad', { prefix: '/trazabilidad', module: 'M2' });

trazabilidad.get('/lotes', { summary: 'Listar lotes de cosecha trazables', perm: 'trazabilidad:read', query: listQuery }, (req) => {
  const q = req.q; const where = ['lc.finca_id = ?']; const args = [req.user.fincaId];
  if (q.q) { where.push('(lc.codigo LIKE ? OR lo.nombre LIKE ? OR cu.nombre LIKE ?)'); args.push(...Array(3).fill(`%${q.q}%`)); }
  if (q.comercializable !== undefined && q.comercializable !== '') { where.push('c.comercializable = ?'); args.push(Number(q.comercializable)); }
  if (q.desde) { where.push('c.fecha >= ?'); args.push(q.desde); } if (q.hasta) { where.push('c.fecha <= ?'); args.push(q.hasta); }
  const from = `lotes_cosecha lc JOIN cosechas c ON c.id=lc.cosecha_id JOIN lotes lo ON lo.id=c.lote_id JOIN plantaciones p ON p.id=c.plantacion_id JOIN cultivos cu ON cu.id=p.cultivo_id`;
  const total = db.prepare(`SELECT COUNT(*) c FROM ${from} WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`SELECT lc.id, lc.codigo, c.id cosecha_id, c.fecha, c.cantidad, c.unidad, c.comercializable, lo.codigo lote_codigo, lo.nombre lote_nombre, cu.nombre cultivo, cu.variedad,
      lc.cantidad_inventariada, (SELECT COALESCE(SUM(delta),0) FROM movimientos_inventario m WHERE m.lote_cosecha_id=lc.id) stock,
      (SELECT COALESCE(SUM(d.cantidad),0) FROM detalle_venta d JOIN ventas v ON v.id=d.venta_id WHERE d.lote_cosecha_id=lc.id AND v.estado='confirmada') vendido
    FROM ${from} WHERE ${where.join(' AND ')} ORDER BY c.fecha DESC, lc.id DESC LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize);
  return new Page(rows, { page: q.page, pageSize: q.pageSize, total });
});
trazabilidad.get('/lotes/:codigo', { summary: 'Historial completo de trazabilidad de un lote de cosecha', perm: 'trazabilidad:read' }, (req) =>
  construirTrazabilidad(req.params.codigo, { fincaId: req.user.fincaId }));

async function qrBuffer(codigo) { return QRCode.toBuffer(qrUrl(codigo), { width: 640, margin: 2, errorCorrectionLevel: 'M', type: 'png' }); }

trazabilidad.get('/lotes/:codigo/qr', { summary: 'Código QR del lote (JSON con data URL y enlace público)', perm: 'trazabilidad:read' }, async (req) => {
  const t = db.prepare('SELECT codigo FROM lotes_cosecha WHERE codigo=? AND finca_id=?').get(req.params.codigo, req.user.fincaId);
  if (!t) throw notFound('Lote de cosecha no encontrado');
  return { codigo: t.codigo, url: qrUrl(t.codigo), dataUrl: await QRCode.toDataURL(qrUrl(t.codigo), { width: 480, margin: 2, errorCorrectionLevel: 'M' }) };
});
trazabilidad.get('/lotes/:codigo/qr.png', { summary: 'Imagen PNG del QR (use ?descargar=1 para forzar descarga)', perm: 'trazabilidad:read', raw: true }, async (req, res) => {
  const t = db.prepare('SELECT codigo FROM lotes_cosecha WHERE codigo=? AND finca_id=?').get(req.params.codigo, req.user.fincaId);
  if (!t) throw notFound('Lote de cosecha no encontrado');
  res.set('Content-Type', 'image/png');
  if (req.query.descargar) res.set('Content-Disposition', `attachment; filename="QR-${t.codigo}.png"`);
  res.send(await qrBuffer(t.codigo));
});
trazabilidad.get('/ventas/:id', { summary: 'Trazabilidad inversa: lotes de cosecha incluidos en una venta', perm: 'trazabilidad:read' }, (req) => {
  const v = db.prepare('SELECT id FROM ventas WHERE id=? AND finca_id=?').get(Number(req.params.id), req.user.fincaId);
  if (!v) throw notFound('Venta no encontrada');
  const lotes = db.prepare(`SELECT DISTINCT lc.codigo FROM detalle_venta d JOIN lotes_cosecha lc ON lc.id=d.lote_cosecha_id WHERE d.venta_id=?`).all(v.id);
  return lotes.map(l => construirTrazabilidad(l.codigo, { fincaId: req.user.fincaId }));
});
trazabilidad.get('/buscar/:codigo', { summary: 'Verifica si un código (leído de un QR) pertenece a esta finca', perm: 'trazabilidad:read' }, (req) => {
  const codigo = String(req.params.codigo).trim().toUpperCase().replace(/^.*\/t\//i, '');
  if (!CODE_RE.test(codigo)) throw notFound('El código no tiene un formato válido de lote de cosecha');
  return construirTrazabilidad(codigo, { fincaId: req.user.fincaId });
});

// ---------- API pública (consulta del cliente mediante QR) ----------
export const publico = createApi('Trazabilidad pública', { prefix: '/public' });
publico.get('/trazabilidad/:codigo', { summary: 'Ficha pública de trazabilidad (sin datos internos ni de trabajadores)', public: true }, (req) => {
  if (!CODE_RE.test(req.params.codigo)) throw notFound('Código de lote no encontrado');
  return construirTrazabilidad(req.params.codigo, { publicView: true });
});
publico.get('/trazabilidad/:codigo/qr.png', { summary: 'QR PNG del lote (público)', public: true, raw: true }, async (req, res) => {
  if (!CODE_RE.test(req.params.codigo) || !db.prepare('SELECT 1 FROM lotes_cosecha WHERE codigo=?').get(req.params.codigo)) throw notFound('Código de lote no encontrado');
  res.set('Content-Type', 'image/png').send(await qrBuffer(req.params.codigo));
});
