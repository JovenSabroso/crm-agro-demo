import { createApi, Page } from '../core/api.js';
import { crud, assertOwned } from '../core/crud.js';
import { z, str, optStr, optNum, optDate, date, id, optId, enm, bool, listQuery } from '../core/schemas.js';
import { db, tx } from '../db/index.js';
import { notFound, unprocessable, conflict, badRequest } from '../core/errors.js';
import { audit } from '../core/audit.js';
import { today, round2 } from '../core/utils.js';

const M = 'M3';

// ---------- Trabajadores ----------
export const trabajadores = createApi('M3 · Trabajadores', { prefix: '/trabajadores', module: M });
const trabBase = {
  nombre: str(100), documento: optStr(30), telefono: optStr(30), cargo: optStr(60), estado: enm(['activo', 'inactivo', 'suspendido']).default('activo'),
  tarifa_jornal: z.coerce.number().min(0).default(0), fecha_ingreso: optDate(), consentimiento_datos: bool().default(0), observaciones: optStr(300), usuario_id: optId(),
};
crud(trabajadores, {
  name: 'trabajador', table: 'trabajadores', perm: 'trabajadores', create: z.object(trabBase), update: z.object(trabBase).partial(),
  owned: { usuario_id: 'usuarios' },
  search: ['x.nombre', 'x.documento', 'x.cargo', 'x.telefono'], filters: { estado: 'x.estado', cargo: 'x.cargo' },
  sorts: { nombre: 'x.nombre', cargo: 'x.cargo', estado: 'x.estado', tarifa: 'x.tarifa_jornal' }, defaultSort: 'nombre ASC',
  beforeDelete() { /* las FK impiden borrar trabajadores con historial; se sugiere inactivarlos */ },
});

trabajadores.get('/:id/reporte', { summary: 'Reporte por trabajador: asistencia, jornales, pagos y anticipos', perm: 'trabajadores:read' }, (req) => {
  const t = db.prepare('SELECT * FROM trabajadores WHERE id=? AND finca_id=?').get(Number(req.params.id), req.user.fincaId);
  if (!t) throw notFound('Trabajador no encontrado');
  const desde = req.query.desde || '0000-01-01'; const hasta = req.query.hasta || '9999-12-31';
  const asistencia = db.prepare(`SELECT estado, COUNT(*) n FROM asistencias WHERE trabajador_id=? AND fecha BETWEEN ? AND ? GROUP BY estado`).all(t.id, desde, hasta);
  const jor = db.prepare(`SELECT COUNT(*) registros, COALESCE(SUM(jornadas),0) jornadas, COALESCE(SUM(monto),0) monto, COALESCE(SUM(CASE WHEN pago_id IS NULL THEN monto END),0) pendiente FROM jornales WHERE trabajador_id=? AND fecha BETWEEN ? AND ?`).get(t.id, desde, hasta);
  const pagos = db.prepare('SELECT * FROM pagos WHERE trabajador_id=? AND fecha BETWEEN ? AND ? ORDER BY fecha DESC').all(t.id, desde, hasta);
  const anticiposPend = db.prepare('SELECT COALESCE(SUM(monto),0) s FROM anticipos WHERE trabajador_id=? AND pago_id IS NULL').get(t.id).s;
  const tareas = db.prepare(`SELECT estado, COUNT(*) n FROM tareas WHERE trabajador_id=? AND fecha BETWEEN ? AND ? GROUP BY estado`).all(t.id, desde, hasta);
  return {
    trabajador: t, periodo: { desde: req.query.desde ?? null, hasta: req.query.hasta ?? null },
    asistencia: Object.fromEntries(['presente', 'ausente', 'retraso'].map(e => [e, asistencia.find(a => a.estado === e)?.n ?? 0])),
    jornales: { ...jor, monto: round2(jor.monto), pendiente: round2(jor.pendiente) },
    pagos, total_pagado: round2(pagos.reduce((s, p) => s + p.neto, 0)), anticipos_pendientes: round2(anticiposPend),
    tareas: Object.fromEntries(tareas.map(r => [r.estado, r.n])),
  };
});

// ---------- Tareas ----------
export const tareas = createApi('M3 · Tareas', { prefix: '/tareas', module: M });
const tareaBase = { trabajador_id: id(), labor_id: optId(), titulo: str(120), descripcion: optStr(300), fecha: date(), estado: enm(['pendiente', 'en_curso', 'completada', 'cancelada']).default('pendiente') };
crud(tareas, {
  name: 'tarea', table: 'tareas', perm: 'trabajadores', create: z.object(tareaBase), update: z.object(tareaBase).partial(),
  owned: { trabajador_id: 'trabajadores', labor_id: 'labores' }, select: 'tr.nombre AS trabajador_nombre, lb.tipo AS labor_tipo',
  joins: 'JOIN trabajadores tr ON tr.id = x.trabajador_id LEFT JOIN labores lb ON lb.id = x.labor_id',
  search: ['x.titulo', 'tr.nombre'], filters: { trabajador_id: 'x.trabajador_id', estado: 'x.estado' }, dateField: 'x.fecha',
  sorts: { fecha: 'x.fecha', trabajador: 'tr.nombre', estado: 'x.estado' }, defaultSort: 'fecha DESC',
});

// ---------- Asistencia ----------
export const asistencia = createApi('M3 · Asistencia', { prefix: '/asistencia', module: M });
const asisItem = z.object({ trabajador_id: id(), estado: enm(['presente', 'ausente', 'retraso']), hora_entrada: z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{2}:\d{2}$/).nullable().optional()), justificacion: optStr(200) });
function upsertAsistencia(fincaId, fecha, it) {
  assertOwned('trabajadores', it.trabajador_id, fincaId, 'trabajador_id');
  db.prepare(`INSERT INTO asistencias (finca_id, trabajador_id, fecha, estado, hora_entrada, justificacion) VALUES (?,?,?,?,?,?)
    ON CONFLICT(trabajador_id, fecha) DO UPDATE SET estado=excluded.estado, hora_entrada=excluded.hora_entrada, justificacion=excluded.justificacion`)
    .run(fincaId, it.trabajador_id, fecha, it.estado, it.hora_entrada ?? null, it.justificacion ?? null);
}
asistencia.post('/', { summary: 'Registrar (o corregir) la asistencia de un trabajador en una fecha', perm: 'trabajadores:write', body: asisItem.extend({ fecha: date().optional() }) }, (req) => {
  const fecha = req.body.fecha || today();
  upsertAsistencia(req.user.fincaId, fecha, req.body);
  return db.prepare('SELECT * FROM asistencias WHERE trabajador_id=? AND fecha=?').get(req.body.trabajador_id, fecha);
});
asistencia.post('/lote', { summary: 'Registrar asistencia de varios trabajadores para una fecha', perm: 'trabajadores:write', status: 200, body: z.object({ fecha: date(), registros: z.array(asisItem).min(1).max(200) }) }, (req) => tx(() => {
  req.body.registros.forEach(it => upsertAsistencia(req.user.fincaId, req.body.fecha, it));
  audit(req, { accion: 'asistencia_masiva', entidad: 'asistencias', id: req.body.fecha, detalle: { registros: req.body.registros.length } });
  return { fecha: req.body.fecha, registrados: req.body.registros.length };
}));
asistencia.get('/', { summary: 'Historial de asistencia (filtros por fecha, trabajador, estado)', perm: 'trabajadores:read', query: listQuery }, (req) => {
  const q = req.q; const where = ['a.finca_id = ?']; const args = [req.user.fincaId];
  if (q.trabajador_id) { where.push('a.trabajador_id = ?'); args.push(q.trabajador_id); } if (q.estado) { where.push('a.estado = ?'); args.push(q.estado); }
  if (q.desde) { where.push('a.fecha >= ?'); args.push(q.desde); } if (q.hasta) { where.push('a.fecha <= ?'); args.push(q.hasta); }
  if (q.q) { where.push('t.nombre LIKE ?'); args.push(`%${q.q}%`); }
  const from = 'asistencias a JOIN trabajadores t ON t.id = a.trabajador_id';
  const total = db.prepare(`SELECT COUNT(*) c FROM ${from} WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`SELECT a.*, t.nombre trabajador_nombre, t.cargo FROM ${from} WHERE ${where.join(' AND ')} ORDER BY a.fecha DESC, t.nombre LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize);
  return new Page(rows, { page: q.page, pageSize: q.pageSize, total });
});
export function resumenAsistencia(fincaId, fecha) {
  const activos = db.prepare("SELECT COUNT(*) c FROM trabajadores WHERE finca_id=? AND estado='activo'").get(fincaId).c;
  const r = db.prepare("SELECT a.estado, COUNT(*) n FROM asistencias a JOIN trabajadores t ON t.id=a.trabajador_id WHERE a.finca_id=? AND a.fecha=? AND t.estado='activo' GROUP BY a.estado").all(fincaId, fecha);
  const n = (e) => r.find(x => x.estado === e)?.n ?? 0;
  return { fecha, activos, presentes: n('presente'), ausentes: n('ausente'), retrasos: n('retraso'), sin_registro: activos - n('presente') - n('ausente') - n('retraso') };
}
asistencia.get('/resumen', { summary: 'Resumen de asistencia del día (presentes, ausentes, retrasos, sin registro)', perm: 'trabajadores:read' }, (req) => resumenAsistencia(req.user.fincaId, req.query.fecha || today()));
asistencia.get('/dia', { summary: 'Planilla del día: todos los trabajadores activos con su estado', perm: 'trabajadores:read' }, (req) => {
  const fecha = req.query.fecha || today();
  return db.prepare(`SELECT t.id trabajador_id, t.nombre, t.cargo, a.estado, a.hora_entrada, a.justificacion FROM trabajadores t
    LEFT JOIN asistencias a ON a.trabajador_id = t.id AND a.fecha = ? WHERE t.finca_id = ? AND t.estado = 'activo' ORDER BY t.nombre`).all(fecha, req.user.fincaId);
});

// ---------- Jornales ----------
export const jornales = createApi('M3 · Jornales', { prefix: '/jornales', module: M });
const jornalBase = { trabajador_id: id(), fecha: date(), jornadas: z.coerce.number().gt(0).max(3), tarifa: optNum({ min: 0 }), lote_id: optId(), labor_id: optId(), tipo: enm(['campo', 'cosecha', 'vivero', 'otro']).default('campo'), observaciones: optStr(200) };
const JOR_FROM = 'jornales j JOIN trabajadores t ON t.id = j.trabajador_id LEFT JOIN lotes lo ON lo.id = j.lote_id';
jornales.get('/', { summary: 'Listar jornales (filtros por fecha, trabajador, lote, estado de pago)', perm: 'trabajadores:read', query: listQuery }, (req) => {
  const q = req.q; const where = ['j.finca_id = ?']; const args = [req.user.fincaId];
  for (const k of ['trabajador_id', 'lote_id', 'tipo']) if (q[k]) { where.push(`j.${k} = ?`); args.push(q[k]); }
  if (q.pagado === '1') where.push('j.pago_id IS NOT NULL'); if (q.pagado === '0') where.push('j.pago_id IS NULL');
  if (q.desde) { where.push('j.fecha >= ?'); args.push(q.desde); } if (q.hasta) { where.push('j.fecha <= ?'); args.push(q.hasta); }
  if (q.q) { where.push('t.nombre LIKE ?'); args.push(`%${q.q}%`); }
  const total = db.prepare(`SELECT COUNT(*) c FROM ${JOR_FROM} WHERE ${where.join(' AND ')}`).get(...args).c;
  const sum = db.prepare(`SELECT COALESCE(SUM(j.monto),0) monto, COALESCE(SUM(j.jornadas),0) jornadas FROM ${JOR_FROM} WHERE ${where.join(' AND ')}`).get(...args);
  const rows = db.prepare(`SELECT j.*, t.nombre trabajador_nombre, lo.nombre lote_nombre FROM ${JOR_FROM} WHERE ${where.join(' AND ')} ORDER BY j.fecha DESC, j.id DESC LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize);
  const p = new Page(rows, { page: q.page, pageSize: q.pageSize, total }); p.meta.totales = { monto: round2(sum.monto), jornadas: sum.jornadas }; return p;
});
jornales.post('/', { summary: 'Registrar jornal (calcula el monto = jornadas × tarifa; rechaza duplicados)', perm: 'pagos:write', body: z.object(jornalBase) }, (req) => tx(() => {
  const b = req.body; const f = req.user.fincaId;
  const t = assertOwned('trabajadores', b.trabajador_id, f, 'trabajador_id');
  if (t.estado !== 'activo') throw unprocessable('El trabajador no está activo');
  if (b.lote_id) assertOwned('lotes', b.lote_id, f, 'lote_id'); if (b.labor_id) assertOwned('labores', b.labor_id, f, 'labor_id');
  const dup = db.prepare('SELECT id FROM jornales WHERE trabajador_id=? AND fecha=? AND COALESCE(lote_id,0)=COALESCE(?,0) AND COALESCE(labor_id,0)=COALESCE(?,0) AND tipo=?').get(b.trabajador_id, b.fecha, b.lote_id ?? null, b.labor_id ?? null, b.tipo);
  if (dup) throw conflict('Jornal duplicado: ya existe un registro para este trabajador, fecha, lote y labor', { jornal_id: dup.id });
  const dia = db.prepare('SELECT COALESCE(SUM(jornadas),0) s FROM jornales WHERE trabajador_id=? AND fecha=?').get(b.trabajador_id, b.fecha).s;
  if (dia + b.jornadas > 3) throw unprocessable(`El trabajador ya acumula ${dia} jornada(s) ese día; el máximo permitido es 3`);
  const tarifa = b.tarifa ?? t.tarifa_jornal;
  const info = db.prepare('INSERT INTO jornales (finca_id, trabajador_id, fecha, jornadas, tarifa, monto, lote_id, labor_id, tipo, observaciones) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(f, b.trabajador_id, b.fecha, b.jornadas, tarifa, round2(b.jornadas * tarifa), b.lote_id ?? null, b.labor_id ?? null, b.tipo, b.observaciones ?? null);
  audit(req, { accion: 'crear', entidad: 'jornales', id: info.lastInsertRowid, detalle: { trabajador_id: b.trabajador_id, jornadas: b.jornadas } });
  return db.prepare('SELECT * FROM jornales WHERE id=?').get(info.lastInsertRowid);
}));
jornales.delete('/:id', { summary: 'Eliminar un jornal aún no pagado', perm: 'pagos:write' }, (req) => {
  const j = db.prepare('SELECT * FROM jornales WHERE id=? AND finca_id=?').get(Number(req.params.id), req.user.fincaId);
  if (!j) throw notFound('Jornal no encontrado');
  if (j.pago_id) throw unprocessable('El jornal ya fue pagado; anula primero el pago correspondiente');
  db.prepare('DELETE FROM jornales WHERE id=?').run(j.id);
  audit(req, { accion: 'eliminar', entidad: 'jornales', id: j.id });
  return { eliminado: true };
});

// ---------- Anticipos ----------
export const anticipos = createApi('M3 · Anticipos', { prefix: '/anticipos', module: M });
anticipos.get('/', { summary: 'Listar anticipos', perm: 'trabajadores:read', query: listQuery }, (req) => {
  const q = req.q; const where = ['a.finca_id = ?']; const args = [req.user.fincaId];
  if (q.trabajador_id) { where.push('a.trabajador_id = ?'); args.push(q.trabajador_id); }
  if (q.descontado === '1') where.push('a.pago_id IS NOT NULL'); if (q.descontado === '0') where.push('a.pago_id IS NULL');
  if (q.desde) { where.push('a.fecha >= ?'); args.push(q.desde); } if (q.hasta) { where.push('a.fecha <= ?'); args.push(q.hasta); }
  const from = 'anticipos a JOIN trabajadores t ON t.id=a.trabajador_id';
  const total = db.prepare(`SELECT COUNT(*) c FROM ${from} WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`SELECT a.*, t.nombre trabajador_nombre FROM ${from} WHERE ${where.join(' AND ')} ORDER BY a.fecha DESC, a.id DESC LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize);
  return new Page(rows, { page: q.page, pageSize: q.pageSize, total });
});
anticipos.post('/', { summary: 'Registrar anticipo a un trabajador', perm: 'pagos:write', body: z.object({ trabajador_id: id(), fecha: date(), monto: z.coerce.number().gt(0), motivo: optStr(200) }) }, (req) => {
  assertOwned('trabajadores', req.body.trabajador_id, req.user.fincaId, 'trabajador_id');
  const info = db.prepare('INSERT INTO anticipos (finca_id, trabajador_id, fecha, monto, motivo) VALUES (?,?,?,?,?)').run(req.user.fincaId, req.body.trabajador_id, req.body.fecha, round2(req.body.monto), req.body.motivo ?? null);
  audit(req, { accion: 'crear', entidad: 'anticipos', id: info.lastInsertRowid, detalle: req.body });
  return db.prepare('SELECT * FROM anticipos WHERE id=?').get(info.lastInsertRowid);
});
anticipos.delete('/:id', { summary: 'Eliminar un anticipo no descontado', perm: 'pagos:write' }, (req) => {
  const r = db.prepare('DELETE FROM anticipos WHERE id=? AND finca_id=? AND pago_id IS NULL').run(Number(req.params.id), req.user.fincaId);
  if (!r.changes) throw unprocessable('El anticipo no existe o ya fue descontado en un pago');
  audit(req, { accion: 'eliminar', entidad: 'anticipos', id: req.params.id });
  return { eliminado: true };
});

// ---------- Pagos ----------
export const pagos = createApi('M3 · Pagos', { prefix: '/pagos', module: M });

/** Calcula (sin guardar) lo que corresponde pagar. Anticipos se descuentan completos, del más antiguo, hasta cubrir el bruto. */
export function calcularPago(fincaId, trabajadorId, desde, hasta, descontarAnticipos = true) {
  const jor = db.prepare('SELECT * FROM jornales WHERE finca_id=? AND trabajador_id=? AND pago_id IS NULL AND fecha BETWEEN ? AND ? ORDER BY fecha').all(fincaId, trabajadorId, desde, hasta);
  const bruto = round2(jor.reduce((s, j) => s + j.monto, 0));
  const antic = db.prepare('SELECT * FROM anticipos WHERE finca_id=? AND trabajador_id=? AND pago_id IS NULL ORDER BY fecha, id').all(fincaId, trabajadorId);
  let desc = 0; const aplicados = [];
  if (descontarAnticipos) for (const a of antic) { if (round2(desc + a.monto) <= bruto) { desc = round2(desc + a.monto); aplicados.push(a); } }
  return { jornales: jor, bruto, anticipos_pendientes: antic, anticipos_aplicados: aplicados, anticipos_descontados: desc, neto: round2(bruto - desc), jornadas: jor.reduce((s, j) => s + j.jornadas, 0) };
}
const calcQuery = z.object({ trabajador_id: id(), desde: date(), hasta: date() }).passthrough();
pagos.get('/calcular', { summary: 'Previsualizar el pago de un trabajador para un período', perm: 'pagos:write', query: calcQuery }, (req) => {
  assertOwned('trabajadores', req.q.trabajador_id, req.user.fincaId, 'trabajador_id');
  return calcularPago(req.user.fincaId, req.q.trabajador_id, req.q.desde, req.q.hasta, req.query.descontar_anticipos !== '0');
});
pagos.post('/', {
  summary: 'Registrar el pago de jornales (marca jornales y anticipos; impide pagar dos veces)', perm: 'pagos:write',
  body: z.object({ trabajador_id: id(), periodo_desde: date(), periodo_hasta: date(), fecha: date().optional(), metodo: str(30).default('efectivo'), descontar_anticipos: bool().default(1), observaciones: optStr(200) })
    .refine(d => d.periodo_hasta >= d.periodo_desde, { message: 'El período es inválido', path: ['periodo_hasta'] }),
}, (req) => tx(() => {
  const b = req.body; const f = req.user.fincaId;
  const t = assertOwned('trabajadores', b.trabajador_id, f, 'trabajador_id');
  const c = calcularPago(f, b.trabajador_id, b.periodo_desde, b.periodo_hasta, !!b.descontar_anticipos);
  if (!c.jornales.length) throw unprocessable('No hay jornales pendientes de pago en ese período (¿ya fueron pagados?)');
  const info = db.prepare('INSERT INTO pagos (finca_id, trabajador_id, fecha, periodo_desde, periodo_hasta, bruto, anticipos_descontados, neto, metodo, observaciones, usuario_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(f, t.id, b.fecha || today(), b.periodo_desde, b.periodo_hasta, c.bruto, c.anticipos_descontados, c.neto, b.metodo, b.observaciones ?? null, req.user.id);
  const pid = info.lastInsertRowid;
  const upJ = db.prepare('UPDATE jornales SET pago_id=? WHERE id=? AND pago_id IS NULL');
  for (const j of c.jornales) if (upJ.run(pid, j.id).changes !== 1) throw conflict('Un jornal fue pagado simultáneamente; reintenta');
  const upA = db.prepare('UPDATE anticipos SET pago_id=? WHERE id=? AND pago_id IS NULL');
  for (const a of c.anticipos_aplicados) upA.run(pid, a.id);
  audit(req, { accion: 'registrar_pago', entidad: 'pagos', id: pid, detalle: { trabajador: t.nombre, bruto: c.bruto, neto: c.neto } });
  return { ...db.prepare('SELECT * FROM pagos WHERE id=?').get(pid), jornales_pagados: c.jornales.length, jornadas: c.jornadas };
}));
pagos.get('/', { summary: 'Historial de pagos', perm: 'trabajadores:read', query: listQuery }, (req) => {
  const q = req.q; const where = ['p.finca_id = ?']; const args = [req.user.fincaId];
  if (q.trabajador_id) { where.push('p.trabajador_id = ?'); args.push(q.trabajador_id); }
  if (q.desde) { where.push('p.fecha >= ?'); args.push(q.desde); } if (q.hasta) { where.push('p.fecha <= ?'); args.push(q.hasta); }
  const from = 'pagos p JOIN trabajadores t ON t.id=p.trabajador_id';
  const total = db.prepare(`SELECT COUNT(*) c FROM ${from} WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`SELECT p.*, t.nombre trabajador_nombre FROM ${from} WHERE ${where.join(' AND ')} ORDER BY p.fecha DESC, p.id DESC LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize);
  return new Page(rows, { page: q.page, pageSize: q.pageSize, total });
});
pagos.delete('/:id', { summary: 'Anular un pago (libera jornales y anticipos asociados)', perm: 'pagos:write' }, (req) => tx(() => {
  const p = db.prepare('SELECT * FROM pagos WHERE id=? AND finca_id=?').get(Number(req.params.id), req.user.fincaId);
  if (!p) throw notFound('Pago no encontrado');
  db.prepare('UPDATE jornales SET pago_id=NULL WHERE pago_id=?').run(p.id);
  db.prepare('UPDATE anticipos SET pago_id=NULL WHERE pago_id=?').run(p.id);
  db.prepare('DELETE FROM pagos WHERE id=?').run(p.id);
  audit(req, { accion: 'anular_pago', entidad: 'pagos', id: p.id, detalle: { neto: p.neto, trabajador_id: p.trabajador_id } });
  return { anulado: true };
}));
