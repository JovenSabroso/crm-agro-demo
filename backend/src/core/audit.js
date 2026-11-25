import { db } from '../db/index.js';

// Registro de operaciones importantes. Nunca debe romper la operación principal.
export function audit(req, { accion, entidad, id, detalle, fincaId, usuarioId }) {
  try {
    db.prepare('INSERT INTO auditoria (finca_id, usuario_id, accion, entidad, entidad_id, detalle, ip) VALUES (?,?,?,?,?,?,?)').run(
      fincaId ?? req?.user?.fincaId ?? null,
      usuarioId ?? req?.user?.id ?? null,
      accion, entidad ?? null, id != null ? String(id) : null,
      detalle ? JSON.stringify(detalle).slice(0, 2000) : null,
      req?.ip ?? null,
    );
  } catch (e) { console.error('[auditoria] no se pudo registrar:', e.message); }
}
