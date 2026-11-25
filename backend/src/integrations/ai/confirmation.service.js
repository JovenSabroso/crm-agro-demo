import { db } from '../../db/index.js';
import { badRequest, notFound, unprocessable } from '../../core/errors.js';
import { registrarCosecha } from '../../modules/campo.js';
import { today } from '../../core/utils.js';

/**
 * Sistema de CONFIRMACIÓN: ninguna propuesta (de IA u otro origen) se guarda como registro real hasta que un humano la confirme.
 * proponer() solo escribe en acciones_pendientes; confirmar() ejecuta el registro mediante los servicios de dominio
 * (con las mismas validaciones: carencia, finca, etc.).
 */
const ejecutores = {
  async cosecha(accion, payload) {
    const lote = db.prepare('SELECT id FROM lotes WHERE finca_id=? AND (codigo=? OR nombre=?)').get(accion.finca_id, payload.lote, payload.lote);
    if (!lote) throw unprocessable(`No se encontró el lote "${payload.lote}"`);
    const req = { user: { id: accion.usuario_id, fincaId: accion.finca_id }, ip: 'integracion', body: { lote_id: lote.id, fecha: payload.fecha || today(), cantidad: payload.cantidad, unidad: payload.unidad } };
    return registrarCosecha(req);
  },
  async labor(accion, payload) {
    const lote = db.prepare('SELECT id FROM lotes WHERE finca_id=? AND (codigo=? OR nombre=?)').get(accion.finca_id, payload.lote, payload.lote);
    if (!lote) throw unprocessable(`No se encontró el lote "${payload.lote}"`);
    const pl = db.prepare("SELECT id FROM plantaciones WHERE lote_id=? AND estado='activo'").get(lote.id);
    const i = db.prepare("INSERT INTO labores (finca_id, lote_id, plantacion_id, tipo, fecha_programada, fecha_realizada, estado, observaciones, created_by) VALUES (?,?,?,?,?,?,'completada',?,?)")
      .run(accion.finca_id, lote.id, pl?.id ?? null, payload.labor, payload.fecha || today(), payload.fecha || today(), payload.observaciones ?? null, accion.usuario_id);
    return { id: i.lastInsertRowid };
  },
};
export const tiposSoportados = Object.keys(ejecutores);

export function proponer({ fincaId, usuarioId = null, origen, tipo, payload }) {
  if (!ejecutores[tipo]) throw badRequest(`Tipo de acción no soportado: ${tipo}`);
  const id = db.prepare('INSERT INTO acciones_pendientes (finca_id, usuario_id, origen, tipo, payload) VALUES (?,?,?,?,?)').run(fincaId, usuarioId, origen, tipo, JSON.stringify(payload)).lastInsertRowid;
  return db.prepare('SELECT * FROM acciones_pendientes WHERE id=?').get(id);
}

export async function confirmar(accionId, fincaId) {
  const a = db.prepare('SELECT * FROM acciones_pendientes WHERE id=? AND finca_id=?').get(accionId, fincaId);
  if (!a) throw notFound('Acción pendiente no encontrada');
  if (a.estado !== 'pendiente') throw unprocessable(`La acción ya está ${a.estado}`);
  const resultado = await ejecutores[a.tipo](a, JSON.parse(a.payload));
  db.prepare("UPDATE acciones_pendientes SET estado='confirmada', resuelta_at=datetime('now') WHERE id=?").run(a.id);
  return resultado;
}
export function rechazar(accionId, fincaId) {
  const r = db.prepare("UPDATE acciones_pendientes SET estado='rechazada', resuelta_at=datetime('now') WHERE id=? AND finca_id=? AND estado='pendiente'").run(accionId, fincaId);
  if (!r.changes) throw unprocessable('La acción no existe o ya fue resuelta');
  return { rechazada: true };
}
