import crypto from 'node:crypto';
import { createApi, Page } from '../core/api.js';
import { crud, assertOwned } from '../core/crud.js';
import { z, str, optStr, optNum, optInt, optDate, date, id, optId, enm, bool } from '../core/schemas.js';
import { db, tx } from '../db/index.js';
import { notFound, badRequest, unprocessable, conflict } from '../core/errors.js';
import { audit } from '../core/audit.js';
import { today, addDays, round3 } from '../core/utils.js';
import { moverStock } from './inventario.service.js';

const M = 'M1';
const activePlantacion = (loteId) => db.prepare("SELECT * FROM plantaciones WHERE lote_id = ? AND estado = 'activo' ORDER BY fecha_siembra DESC LIMIT 1").get(loteId);

/** Resuelve/valida la plantación asociada a un registro de campo. */
function resolvePlantacion(data, existing, fincaId) {
  const loteId = data.lote_id ?? existing?.lote_id;
  if (data.plantacion_id === undefined && !existing) data.plantacion_id = activePlantacion(loteId)?.id ?? null;
  if (data.plantacion_id) {
    const p = assertOwned('plantaciones', data.plantacion_id, fincaId, 'plantacion_id');
    if (p.lote_id !== loteId) throw badRequest('La plantación no corresponde al lote indicado');
  }
  return data;
}

// =============== Labores ===============
export const labores = createApi('M1 · Labores', { prefix: '/labores', module: M });
const laborBase = {
  lote_id: id(), plantacion_id: optId(), tipo: str(60), descripcion: optStr(300), fecha_programada: date(), fecha_realizada: optDate(),
  estado: enm(['pendiente', 'en_curso', 'completada', 'cancelada']).default('pendiente'), responsable_id: optId(), observaciones: optStr(500),
};
const LABOR_JOIN = 'JOIN lotes lo ON lo.id = x.lote_id LEFT JOIN trabajadores tr ON tr.id = x.responsable_id';
crud(labores, {
  name: 'labor', table: 'labores', perm: 'campo', create: z.object(laborBase), update: z.object(laborBase).partial(),
  owned: { lote_id: 'lotes', responsable_id: 'trabajadores' },
  select: 'lo.codigo AS lote_codigo, lo.nombre AS lote_nombre, tr.nombre AS responsable_nombre, (x.estado IN (\'pendiente\',\'en_curso\') AND x.fecha_programada < date(\'now\')) AS atrasada',
  joins: LABOR_JOIN, search: ['x.tipo', 'x.descripcion', 'lo.nombre', 'lo.codigo'],
  filters: { lote_id: 'x.lote_id', estado: 'x.estado', responsable_id: 'x.responsable_id', tipo: 'x.tipo' }, dateField: 'x.fecha_programada',
  sorts: { fecha: 'x.fecha_programada', tipo: 'x.tipo', estado: 'x.estado', lote: 'lo.codigo' }, defaultSort: 'fecha ASC',
  before(data, req, existing) {
    resolvePlantacion(data, existing, req.user.fincaId);
    if (data.estado === 'completada' && !data.fecha_realizada && !existing?.fecha_realizada) {
      const prog = data.fecha_programada ?? existing?.fecha_programada;
      data.fecha_realizada = prog && prog < today() ? prog : today();   // una labor pasada se asume realizada en su fecha programada
    }
    return data;
  },
});
labores.post('/:id/completar', { summary: 'Marcar labor como completada', perm: 'campo:write', status: 200, body: z.object({ fecha_realizada: optDate(), observaciones: optStr(500) }) }, (req) => {
  const l = db.prepare('SELECT * FROM labores WHERE id = ? AND finca_id = ?').get(Number(req.params.id), req.user.fincaId);
  if (!l) throw notFound('Labor no encontrada');
  if (l.estado === 'cancelada') throw unprocessable('No se puede completar una labor cancelada');
  db.prepare("UPDATE labores SET estado='completada', fecha_realizada=?, observaciones=COALESCE(?,observaciones) WHERE id=?").run(req.body.fecha_realizada || today(), req.body.observaciones ?? null, l.id);
  audit(req, { accion: 'completar', entidad: 'labores', id: l.id });
  return db.prepare('SELECT * FROM labores WHERE id=?').get(l.id);
});

// =============== Riegos ===============
export const riegos = createApi('M1 · Riego', { prefix: '/riegos', module: M });
const riegoBase = { lote_id: id(), plantacion_id: optId(), fecha: date(), metodo: str(40).default('goteo'), duracion_min: optInt({ min: 0 }), volumen_litros: optNum({ min: 0 }), responsable_id: optId(), observaciones: optStr(500) };
crud(riegos, {
  name: 'riego', table: 'riegos', perm: 'campo', create: z.object(riegoBase), update: z.object(riegoBase).partial(),
  owned: { lote_id: 'lotes', responsable_id: 'trabajadores' },
  select: 'lo.codigo AS lote_codigo, lo.nombre AS lote_nombre, tr.nombre AS responsable_nombre',
  joins: 'JOIN lotes lo ON lo.id = x.lote_id LEFT JOIN trabajadores tr ON tr.id = x.responsable_id',
  search: ['lo.nombre', 'lo.codigo', 'x.metodo'], filters: { lote_id: 'x.lote_id' }, dateField: 'x.fecha',
  sorts: { fecha: 'x.fecha', lote: 'lo.codigo', volumen: 'x.volumen_litros' }, defaultSort: 'fecha DESC',
  before: (data, req, existing) => resolvePlantacion(data, existing, req.user.fincaId),
});

// =============== Aplicaciones fitosanitarias ===============
export const aplicaciones = createApi('M1 · Aplicaciones fitosanitarias', { prefix: '/aplicaciones', module: M });
const aplBase = {
  lote_id: id(), plantacion_id: optId(), producto_id: optId(), producto_nombre: optStr(120), motivo: str(200),
  fecha_programada: optDate(), fecha_aplicacion: optDate(),
  dosis_registrada: optStr(200), cantidad_usada: optNum({ min: 0 }), periodo_carencia_dias: optInt({ min: 0, max: 365 }),
  responsable_id: optId(), observaciones: optStr(500),
};
const APL_SEL = `a.*, lo.codigo AS lote_codigo, lo.nombre AS lote_nombre, tr.nombre AS responsable_nombre,
  (a.estado = 'aplicada' AND a.fecha_fin_carencia >= date('now')) AS carencia_vigente,
  CASE WHEN a.estado = 'aplicada' AND a.fecha_fin_carencia >= date('now') THEN CAST(julianday(a.fecha_fin_carencia) - julianday(date('now')) AS INTEGER) ELSE 0 END AS dias_carencia_restantes,
  (a.estado = 'pendiente' AND a.fecha_programada IS NOT NULL AND a.fecha_programada < date('now')) AS atrasada`;
const APL_FROM = 'aplicaciones_fito a JOIN lotes lo ON lo.id = a.lote_id LEFT JOIN trabajadores tr ON tr.id = a.responsable_id';
const getApl = (idv, fincaId) => db.prepare(`SELECT ${APL_SEL} FROM ${APL_FROM} WHERE a.id = ? AND a.finca_id = ?`).get(idv, fincaId);

aplicaciones.get('/', { summary: 'Listar aplicaciones fitosanitarias', perm: 'campo:read' }, (req) => {
  const q = req.query; const where = ['a.finca_id = ?']; const args = [req.user.fincaId];
  for (const k of ['lote_id', 'estado', 'plantacion_id']) if (q[k]) { where.push(`a.${k} = ?`); args.push(q[k]); }
  if (q.carencia_vigente === '1') where.push("a.estado='aplicada' AND a.fecha_fin_carencia >= date('now')");
  if (q.q) { where.push('(a.producto_nombre LIKE ? OR a.motivo LIKE ? OR lo.nombre LIKE ?)'); args.push(...Array(3).fill(`%${q.q}%`)); }
  if (q.desde) { where.push('COALESCE(a.fecha_aplicacion, a.fecha_programada) >= ?'); args.push(q.desde); }
  if (q.hasta) { where.push('COALESCE(a.fecha_aplicacion, a.fecha_programada) <= ?'); args.push(q.hasta); }
  const page = Math.max(1, Number(q.page) || 1); const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 20));
  const total = db.prepare(`SELECT COUNT(*) c FROM ${APL_FROM} WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`SELECT ${APL_SEL} FROM ${APL_FROM} WHERE ${where.join(' AND ')} ORDER BY COALESCE(a.fecha_aplicacion, a.fecha_programada) DESC, a.id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize);
  return new Page(rows, { page, pageSize, total });
});
aplicaciones.get('/:id', { summary: 'Obtener aplicación', perm: 'campo:read' }, (req) => {
  const r = getApl(Number(req.params.id), req.user.fincaId);
  if (!r) throw notFound('Aplicación no encontrada');
  return r;
});

/** Registra la aplicación como realizada: calcula fin de carencia y descuenta inventario si corresponde. */
function marcarAplicada(apl, d, req) {
  const fecha = d.fecha_aplicacion || today();
  const carencia = d.periodo_carencia_dias ?? apl.periodo_carencia_dias ?? 0;
  const cantidad = d.cantidad_usada ?? apl.cantidad_usada;
  db.prepare(`UPDATE aplicaciones_fito SET estado='aplicada', fecha_aplicacion=?, periodo_carencia_dias=?, fecha_fin_carencia=?, cantidad_usada=?,
    dosis_registrada=COALESCE(?,dosis_registrada), responsable_id=COALESCE(?,responsable_id) WHERE id=?`)
    .run(fecha, carencia, addDays(fecha, carencia), cantidad ?? null, d.dosis_registrada ?? null, d.responsable_id ?? null, apl.id);
  if (apl.producto_id && cantidad > 0) {
    moverStock({ fincaId: req.user.fincaId, productoId: apl.producto_id, tipo: 'salida', motivo: 'consumo', cantidad, fecha, loteId: apl.lote_id,
      referenciaTipo: 'aplicacion', referenciaId: apl.id, claveIdempotencia: `apl:${apl.id}`, usuarioId: req.user.id, observaciones: `Aplicación fitosanitaria #${apl.id}` });
  }
}

aplicaciones.post('/', { summary: 'Registrar o programar una aplicación fitosanitaria', perm: 'campo:write', body: z.object(aplBase) }, (req) => tx(() => {
  const b = { ...req.body }; const fincaId = req.user.fincaId;
  assertOwned('lotes', b.lote_id, fincaId, 'lote_id'); if (b.responsable_id) assertOwned('trabajadores', b.responsable_id, fincaId, 'responsable_id');
  resolvePlantacion(b, null, fincaId);
  let prod = null;
  if (b.producto_id) { prod = assertOwned('productos', b.producto_id, fincaId, 'producto_id'); if (prod.categoria !== 'agroquimicos') throw badRequest('El producto debe pertenecer a la categoría agroquímicos'); }
  const nombre = b.producto_nombre || prod?.nombre;
  if (!nombre) throw badRequest('Indica el producto utilizado (nombre o producto del inventario)');
  const aplicada = !!b.fecha_aplicacion;
  if (!aplicada && !b.fecha_programada) throw badRequest('Indica la fecha programada o la fecha de aplicación');
  const carencia = b.periodo_carencia_dias ?? prod?.periodo_carencia_dias ?? 0;
  const info = db.prepare(`INSERT INTO aplicaciones_fito (finca_id, lote_id, plantacion_id, producto_id, producto_nombre, motivo, estado, fecha_programada, dosis_registrada, cantidad_usada, periodo_carencia_dias, responsable_id, observaciones)
    VALUES (?,?,?,?,?,?,'pendiente',?,?,?,?,?,?)`).run(fincaId, b.lote_id, b.plantacion_id ?? null, b.producto_id ?? null, nombre, b.motivo, b.fecha_programada ?? b.fecha_aplicacion ?? null, b.dosis_registrada ?? null, b.cantidad_usada ?? null, carencia, b.responsable_id ?? null, b.observaciones ?? null);
  const apl = db.prepare('SELECT * FROM aplicaciones_fito WHERE id=?').get(info.lastInsertRowid);
  if (aplicada) marcarAplicada(apl, { ...b, periodo_carencia_dias: carencia }, req);
  audit(req, { accion: aplicada ? 'registrar_aplicacion' : 'programar_aplicacion', entidad: 'aplicaciones_fito', id: apl.id, detalle: { producto: nombre, lote_id: b.lote_id, carencia } });
  return getApl(apl.id, fincaId);
}));

aplicaciones.post('/:id/aplicar', {
  summary: 'Marcar una aplicación pendiente como realizada (calcula carencia y descuenta inventario)', perm: 'campo:write', status: 200,
  body: z.object({ fecha_aplicacion: optDate(), cantidad_usada: optNum({ min: 0 }), dosis_registrada: optStr(200), periodo_carencia_dias: optInt({ min: 0, max: 365 }), responsable_id: optId() }),
}, (req) => tx(() => {
  const apl = db.prepare('SELECT * FROM aplicaciones_fito WHERE id=? AND finca_id=?').get(Number(req.params.id), req.user.fincaId);
  if (!apl) throw notFound('Aplicación no encontrada');
  if (apl.estado !== 'pendiente') throw unprocessable(`La aplicación ya está ${apl.estado}`);
  if (req.body.responsable_id) assertOwned('trabajadores', req.body.responsable_id, req.user.fincaId, 'responsable_id');
  marcarAplicada(apl, req.body, req);
  audit(req, { accion: 'registrar_aplicacion', entidad: 'aplicaciones_fito', id: apl.id });
  return getApl(apl.id, req.user.fincaId);
}));
aplicaciones.post('/:id/cancelar', { summary: 'Cancelar una aplicación pendiente', perm: 'campo:write', status: 200 }, (req) => {
  const r = db.prepare("UPDATE aplicaciones_fito SET estado='cancelada' WHERE id=? AND finca_id=? AND estado='pendiente'").run(Number(req.params.id), req.user.fincaId);
  if (!r.changes) throw unprocessable('Solo se pueden cancelar aplicaciones pendientes');
  audit(req, { accion: 'cancelar', entidad: 'aplicaciones_fito', id: req.params.id });
  return getApl(Number(req.params.id), req.user.fincaId);
});
aplicaciones.put('/:id', { summary: 'Editar una aplicación pendiente', perm: 'campo:write', body: z.object({ motivo: str(200), fecha_programada: date(), dosis_registrada: optStr(200), cantidad_usada: optNum({ min: 0 }), periodo_carencia_dias: optInt({ min: 0, max: 365 }), responsable_id: optId(), observaciones: optStr(500) }).partial() }, (req) => {
  const apl = db.prepare('SELECT * FROM aplicaciones_fito WHERE id=? AND finca_id=?').get(Number(req.params.id), req.user.fincaId);
  if (!apl) throw notFound('Aplicación no encontrada');
  if (apl.estado !== 'pendiente') throw unprocessable('Solo se pueden editar aplicaciones pendientes (las aplicadas son registro histórico)');
  const keys = Object.keys(req.body).filter(k => req.body[k] !== undefined);
  if (req.body.responsable_id) assertOwned('trabajadores', req.body.responsable_id, req.user.fincaId, 'responsable_id');
  if (keys.length) db.prepare(`UPDATE aplicaciones_fito SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map(k => req.body[k]), apl.id);
  return getApl(apl.id, req.user.fincaId);
});
aplicaciones.delete('/:id', { summary: 'Eliminar aplicación pendiente o cancelada', perm: 'campo:write' }, (req) => {
  const r = db.prepare("DELETE FROM aplicaciones_fito WHERE id=? AND finca_id=? AND estado IN ('pendiente','cancelada')").run(Number(req.params.id), req.user.fincaId);
  if (!r.changes) throw unprocessable('Solo se pueden eliminar aplicaciones pendientes o canceladas');
  audit(req, { accion: 'eliminar', entidad: 'aplicaciones_fito', id: req.params.id });
  return { eliminado: true };
});

// =============== Cosechas ===============
export const cosechas = createApi('M1 · Cosechas', { prefix: '/cosechas', module: M });

/** Aplicaciones realizadas cuyo período de carencia aún regía en la fecha de cosecha. */
export function verificarCarencia(plantacionId, loteId, fechaCosecha) {
  return db.prepare(`SELECT id, producto_nombre, fecha_aplicacion, periodo_carencia_dias, fecha_fin_carencia FROM aplicaciones_fito
    WHERE estado='aplicada' AND (plantacion_id = ? OR (plantacion_id IS NULL AND lote_id = ?))
      AND fecha_aplicacion <= ? AND fecha_fin_carencia > ? ORDER BY fecha_fin_carencia DESC`).all(plantacionId, loteId, fechaCosecha, fechaCosecha);
}
function exigirCarenciaCumplida(c) {
  const v = verificarCarencia(c.plantacion_id, c.lote_id, c.fecha);
  if (v.length) {
    const a = v[0];
    throw unprocessable(`No se puede marcar como comercializable: la cosecha del ${c.fecha} incumple el período de carencia de "${a.producto_nombre}" (aplicado el ${a.fecha_aplicacion}, carencia hasta el ${a.fecha_fin_carencia}).`, { aplicaciones: v });
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generarCodigoLote(fecha) {
  for (let i = 0; i < 10; i++) {
    let s = ''; for (let k = 0; k < 6; k++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    const code = `LC-${fecha.replaceAll('-', '')}-${s}`;
    if (!db.prepare('SELECT 1 FROM lotes_cosecha WHERE codigo=?').get(code)) return code;
  }
  throw new Error('No se pudo generar un código único');
}

const COS_SEL = `c.*, lo.codigo AS lote_codigo, lo.nombre AS lote_nombre, cu.nombre AS cultivo_nombre, cu.variedad AS cultivo_variedad,
  lc.id AS lote_cosecha_id, lc.codigo AS codigo_lote_cosecha, lc.cantidad_inventariada, lc.producto_id, tr.nombre AS responsable_nombre,
  (SELECT COALESCE(SUM(m.delta),0) FROM movimientos_inventario m WHERE m.lote_cosecha_id = lc.id) AS stock_lote`;
const COS_FROM = `cosechas c JOIN lotes lo ON lo.id = c.lote_id JOIN plantaciones p ON p.id = c.plantacion_id JOIN cultivos cu ON cu.id = p.cultivo_id
  LEFT JOIN lotes_cosecha lc ON lc.cosecha_id = c.id LEFT JOIN trabajadores tr ON tr.id = c.responsable_id`;
const getCos = (idv, fincaId) => db.prepare(`SELECT ${COS_SEL} FROM ${COS_FROM} WHERE c.id=? AND c.finca_id=?`).get(idv, fincaId);

cosechas.get('/', { summary: 'Listar cosechas', perm: 'campo:read' }, (req) => {
  const q = req.query; const where = ['c.finca_id = ?']; const args = [req.user.fincaId];
  for (const [k, col] of Object.entries({ lote_id: 'c.lote_id', plantacion_id: 'c.plantacion_id', cultivo_id: 'p.cultivo_id', comercializable: 'c.comercializable' })) if (q[k] !== undefined && q[k] !== '') { where.push(`${col} = ?`); args.push(q[k]); }
  if (q.q) { where.push('(lo.nombre LIKE ? OR cu.nombre LIKE ? OR lc.codigo LIKE ?)'); args.push(...Array(3).fill(`%${q.q}%`)); }
  if (q.desde) { where.push('c.fecha >= ?'); args.push(q.desde); } if (q.hasta) { where.push('c.fecha <= ?'); args.push(q.hasta); }
  const page = Math.max(1, Number(q.page) || 1); const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 20));
  const total = db.prepare(`SELECT COUNT(*) c FROM ${COS_FROM} WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`SELECT ${COS_SEL} FROM ${COS_FROM} WHERE ${where.join(' AND ')} ORDER BY c.fecha DESC, c.id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize);
  return new Page(rows, { page, pageSize, total });
});
cosechas.get('/:id', { summary: 'Obtener cosecha con estado de carencia', perm: 'campo:read' }, (req) => {
  const c = getCos(Number(req.params.id), req.user.fincaId);
  if (!c) throw notFound('Cosecha no encontrada');
  return { ...c, carencia_incumplida: verificarCarencia(c.plantacion_id, c.lote_id, c.fecha) };
});

/** Ingresa (total o parcialmente) una cosecha al inventario de productos cosechados. */
export function ingresarCosechaInventario(cosecha, { productoId, cantidad, costoUnitario }, req) {
  return tx(() => {
    const fincaId = req.user.fincaId;
    const lc = db.prepare('SELECT * FROM lotes_cosecha WHERE cosecha_id = ?').get(cosecha.id);
    const pendiente = round3(cosecha.cantidad - lc.cantidad_inventariada);
    const qty = cantidad ?? pendiente;
    if (!(qty > 0)) throw unprocessable('La cosecha ya fue ingresada por completo al inventario');
    if (qty > pendiente + 1e-9) throw unprocessable(`Solo quedan ${pendiente} ${cosecha.unidad} de esta cosecha por ingresar`);
    let prodId = productoId;
    if (!prodId) {
      const cu = db.prepare('SELECT cu.* FROM plantaciones p JOIN cultivos cu ON cu.id=p.cultivo_id WHERE p.id=?').get(cosecha.plantacion_id);
      const nombre = cu.variedad ? `${cu.nombre} ${cu.variedad}` : cu.nombre;
      prodId = lc.producto_id ?? db.prepare("SELECT id FROM productos WHERE finca_id=? AND categoria='productos_cosechados' AND nombre=? AND unidad=?").get(fincaId, nombre, cosecha.unidad)?.id;
      if (!prodId) prodId = db.prepare("INSERT INTO productos (finca_id, categoria, nombre, unidad) VALUES (?, 'productos_cosechados', ?, ?)").run(fincaId, nombre, cosecha.unidad).lastInsertRowid;
    }
    const prod = assertOwned('productos', prodId, fincaId, 'producto_id');
    if (prod.categoria !== 'productos_cosechados') throw badRequest('El producto debe ser de la categoría productos cosechados');
    if (prod.unidad !== cosecha.unidad) throw unprocessable(`La unidad del producto (${prod.unidad}) no coincide con la de la cosecha (${cosecha.unidad})`);
    if (lc.producto_id && lc.producto_id !== prodId) throw unprocessable('Este lote de cosecha ya fue ingresado con otro producto');
    const mov = moverStock({ fincaId, productoId: prodId, tipo: 'entrada', motivo: 'cosecha', cantidad: qty, costoUnitario, fecha: cosecha.fecha, loteCosechaId: lc.id,
      loteId: cosecha.lote_id, referenciaTipo: 'cosecha', referenciaId: cosecha.id, usuarioId: req.user.id, observaciones: `Cosecha ${lc.codigo}` });
    db.prepare('UPDATE lotes_cosecha SET producto_id = ?, cantidad_inventariada = cantidad_inventariada + ? WHERE id = ?').run(prodId, qty, lc.id);
    audit(req, { accion: 'ingresar_inventario', entidad: 'cosechas', id: cosecha.id, detalle: { producto_id: prodId, cantidad: qty, lote_cosecha: lc.codigo } });
    return mov;
  });
}

/** Registra una cosecha y su lote de cosecha (código QR). Servicio reutilizable (también por la capa de confirmación futura). */
export const registrarCosecha = (req) => tx(() => {
  const b = { ...req.body }; const fincaId = req.user.fincaId;
  assertOwned('lotes', b.lote_id, fincaId, 'lote_id'); if (b.responsable_id) assertOwned('trabajadores', b.responsable_id, fincaId, 'responsable_id');
  resolvePlantacion(b, null, fincaId);
  if (!b.plantacion_id) throw unprocessable('El lote no tiene un cultivo activo. Registra primero la plantación (cultivo) del lote.');
  const pl = db.prepare('SELECT p.*, cu.unidad_cosecha FROM plantaciones p JOIN cultivos cu ON cu.id=p.cultivo_id WHERE p.id=?').get(b.plantacion_id);
  if (b.fecha < pl.fecha_siembra) throw unprocessable('La fecha de cosecha no puede ser anterior a la siembra del cultivo');
  const unidad = b.unidad || pl.unidad_cosecha || 'kg';
  const info = db.prepare(`INSERT INTO cosechas (finca_id, lote_id, plantacion_id, fecha, cantidad, unidad, calidad, comercializable, responsable_id, observaciones, created_by) VALUES (?,?,?,?,?,?,?,0,?,?,?)`)
    .run(fincaId, b.lote_id, b.plantacion_id, b.fecha, b.cantidad, unidad, b.calidad ?? null, b.responsable_id ?? null, b.observaciones ?? null, req.user.id);
  const cos = db.prepare('SELECT * FROM cosechas WHERE id=?').get(info.lastInsertRowid);
  if (b.comercializable) exigirCarenciaCumplida(cos);
  db.prepare('UPDATE cosechas SET comercializable=? WHERE id=?').run(b.comercializable ? 1 : 0, cos.id);
  db.prepare('INSERT INTO lotes_cosecha (finca_id, cosecha_id, codigo) VALUES (?,?,?)').run(fincaId, cos.id, generarCodigoLote(b.fecha));
  if (b.ingresar_inventario) ingresarCosechaInventario({ ...cos, unidad }, {}, req);
  audit(req, { accion: 'registrar_cosecha', entidad: 'cosechas', id: cos.id, detalle: { lote_id: b.lote_id, cantidad: b.cantidad, unidad } });
  const out = getCos(cos.id, fincaId);
  return { ...out, carencia_incumplida: verificarCarencia(out.plantacion_id, out.lote_id, out.fecha) };
});

cosechas.post('/', {
  summary: 'Registrar una cosecha (genera automáticamente su lote de cosecha con código QR)', perm: 'campo:write',
  body: z.object({ lote_id: id(), plantacion_id: optId(), fecha: date(), cantidad: z.coerce.number().gt(0, 'Debe ser mayor que 0'), unidad: z.string().trim().max(15).optional(), calidad: optStr(60), comercializable: bool().optional(), ingresar_inventario: bool().optional(), responsable_id: optId(), observaciones: optStr(500) }),
}, (req) => registrarCosecha(req));

cosechas.put('/:id', { summary: 'Editar cosecha (solo si no fue ingresada al inventario)', perm: 'campo:write', body: z.object({ fecha: date(), cantidad: z.coerce.number().gt(0), calidad: optStr(60), responsable_id: optId(), observaciones: optStr(500) }).partial() }, (req) => tx(() => {
  const c = db.prepare('SELECT c.*, lc.cantidad_inventariada FROM cosechas c JOIN lotes_cosecha lc ON lc.cosecha_id=c.id WHERE c.id=? AND c.finca_id=?').get(Number(req.params.id), req.user.fincaId);
  if (!c) throw notFound('Cosecha no encontrada');
  if (c.cantidad_inventariada > 0) throw unprocessable('La cosecha ya fue ingresada al inventario; corrige mediante ajustes de inventario');
  const b = req.body; if (b.responsable_id) assertOwned('trabajadores', b.responsable_id, req.user.fincaId, 'responsable_id');
  const merged = { ...c, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) };
  if (c.comercializable) exigirCarenciaCumplida(merged);
  const keys = Object.keys(b).filter(k => b[k] !== undefined);
  if (keys.length) db.prepare(`UPDATE cosechas SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map(k => b[k]), c.id);
  audit(req, { accion: 'actualizar', entidad: 'cosechas', id: c.id, detalle: b });
  return getCos(c.id, req.user.fincaId);
}));

cosechas.patch('/:id/comercializable', { summary: 'Marcar/desmarcar como comercializable (valida el período de carencia)', perm: 'campo:write', status: 200, body: z.object({ comercializable: bool() }) }, (req) => {
  const c = db.prepare('SELECT * FROM cosechas WHERE id=? AND finca_id=?').get(Number(req.params.id), req.user.fincaId);
  if (!c) throw notFound('Cosecha no encontrada');
  if (req.body.comercializable) exigirCarenciaCumplida(c);
  db.prepare('UPDATE cosechas SET comercializable=? WHERE id=?').run(req.body.comercializable, c.id);
  audit(req, { accion: req.body.comercializable ? 'liberar_comercializacion' : 'retener_cosecha', entidad: 'cosechas', id: c.id });
  return getCos(c.id, req.user.fincaId);
});

cosechas.post('/:id/inventario', {
  summary: 'Ingresar la cosecha al inventario de productos cosechados', perm: 'inventario:write', module: 'M4',
  body: z.object({ producto_id: optId(), cantidad: z.preprocess(v => v === '' ? null : v, z.coerce.number().gt(0).nullable().optional()), costo_unitario: optNum({ min: 0 }) }),
}, (req) => {
  const c = db.prepare('SELECT * FROM cosechas WHERE id=? AND finca_id=?').get(Number(req.params.id), req.user.fincaId);
  if (!c) throw notFound('Cosecha no encontrada');
  const mov = ingresarCosechaInventario(c, { productoId: req.body.producto_id ?? undefined, cantidad: req.body.cantidad ?? undefined, costoUnitario: req.body.costo_unitario ?? undefined }, req);
  return { movimiento: mov, cosecha: getCos(c.id, req.user.fincaId) };
});

cosechas.delete('/:id', { summary: 'Eliminar cosecha (solo si no tiene inventario ni ventas)', perm: 'campo:write' }, (req) => {
  const c = db.prepare('SELECT c.*, lc.cantidad_inventariada, lc.id AS lcid FROM cosechas c JOIN lotes_cosecha lc ON lc.cosecha_id=c.id WHERE c.id=? AND c.finca_id=?').get(Number(req.params.id), req.user.fincaId);
  if (!c) throw notFound('Cosecha no encontrada');
  if (c.cantidad_inventariada > 0) throw conflict('La cosecha ya fue ingresada al inventario y no puede eliminarse');
  db.prepare('DELETE FROM cosechas WHERE id=?').run(c.id);
  audit(req, { accion: 'eliminar', entidad: 'cosechas', id: c.id });
  return { eliminado: true };
});

// =============== Calendario agrícola ===============
export const campo = createApi('M1 · Calendario', { prefix: '/campo', module: M });
export function eventosCalendario(f, desde, hasta) {
  const ev = [];
  for (const r of db.prepare(`SELECT l.id, l.tipo, l.estado, l.fecha_programada fecha, lo.nombre lote FROM labores l JOIN lotes lo ON lo.id=l.lote_id WHERE l.finca_id=? AND l.fecha_programada BETWEEN ? AND ?`).all(f, desde, hasta))
    ev.push({ fecha: r.fecha, tipo: 'labor', titulo: r.tipo, detalle: r.lote, estado: r.estado, ref: { tipo: 'labor', id: r.id } });
  for (const r of db.prepare(`SELECT r.id, r.metodo, r.fecha, lo.nombre lote FROM riegos r JOIN lotes lo ON lo.id=r.lote_id WHERE r.finca_id=? AND r.fecha BETWEEN ? AND ?`).all(f, desde, hasta))
    ev.push({ fecha: r.fecha, tipo: 'riego', titulo: `Riego (${r.metodo})`, detalle: r.lote, estado: 'completada', ref: { tipo: 'riego', id: r.id } });
  for (const r of db.prepare(`SELECT a.id, a.producto_nombre, a.estado, COALESCE(a.fecha_aplicacion, a.fecha_programada) fecha, lo.nombre lote FROM aplicaciones_fito a JOIN lotes lo ON lo.id=a.lote_id WHERE a.finca_id=? AND a.estado<>'cancelada' AND COALESCE(a.fecha_aplicacion, a.fecha_programada) BETWEEN ? AND ?`).all(f, desde, hasta))
    ev.push({ fecha: r.fecha, tipo: 'aplicacion', titulo: `Aplicación: ${r.producto_nombre}`, detalle: r.lote, estado: r.estado === 'aplicada' ? 'completada' : 'pendiente', ref: { tipo: 'aplicacion', id: r.id } });
  for (const r of db.prepare(`SELECT a.id, a.producto_nombre, a.fecha_fin_carencia fecha, lo.nombre lote FROM aplicaciones_fito a JOIN lotes lo ON lo.id=a.lote_id WHERE a.finca_id=? AND a.estado='aplicada' AND a.fecha_fin_carencia BETWEEN ? AND ?`).all(f, desde, hasta))
    ev.push({ fecha: r.fecha, tipo: 'carencia', titulo: `Fin de carencia: ${r.producto_nombre}`, detalle: r.lote, estado: 'pendiente', ref: { tipo: 'aplicacion', id: r.id } });
  for (const r of db.prepare(`SELECT c.id, c.fecha, c.cantidad, c.unidad, lo.nombre lote, cu.nombre cultivo FROM cosechas c JOIN lotes lo ON lo.id=c.lote_id JOIN plantaciones p ON p.id=c.plantacion_id JOIN cultivos cu ON cu.id=p.cultivo_id WHERE c.finca_id=? AND c.fecha BETWEEN ? AND ?`).all(f, desde, hasta))
    ev.push({ fecha: r.fecha, tipo: 'cosecha', titulo: `Cosecha ${r.cultivo}: ${r.cantidad} ${r.unidad}`, detalle: r.lote, estado: 'completada', ref: { tipo: 'cosecha', id: r.id } });
  for (const r of db.prepare(`SELECT p.id, p.fecha_cosecha_estimada fecha, lo.nombre lote, cu.nombre cultivo FROM plantaciones p JOIN lotes lo ON lo.id=p.lote_id JOIN cultivos cu ON cu.id=p.cultivo_id WHERE p.finca_id=? AND p.estado='activo' AND p.fecha_cosecha_estimada BETWEEN ? AND ?`).all(f, desde, hasta))
    ev.push({ fecha: r.fecha, tipo: 'cosecha_estimada', titulo: `Cosecha estimada: ${r.cultivo}`, detalle: r.lote, estado: 'pendiente', ref: { tipo: 'plantacion', id: r.id } });
  return ev.sort((a, b) => a.fecha.localeCompare(b.fecha));
}
campo.get('/calendario', { summary: 'Eventos del calendario agrícola (labores, riegos, aplicaciones, carencias, cosechas)', perm: 'campo:read' }, (req) =>
  eventosCalendario(req.user.fincaId, req.query.desde || addDays(today(), -30), req.query.hasta || addDays(today(), 60)));
