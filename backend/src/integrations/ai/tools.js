import { db } from '../../db/index.js';

/**
 * Herramientas de CONSULTA (solo lectura) que el futuro agente podrá invocar. Funcionan hoy contra la base de datos real,
 * pero nada las expone a ningún modelo externo en esta fase.
 */
export const herramientas = {
  contextoFinca(fincaId) {
    return {
      finca: db.prepare('SELECT nombre, moneda FROM fincas WHERE id=?').get(fincaId),
      lotes: db.prepare("SELECT codigo, nombre FROM lotes WHERE finca_id=? AND estado='activo' ORDER BY codigo").all(fincaId),
      cultivos: db.prepare('SELECT nombre, variedad, unidad_cosecha FROM cultivos WHERE finca_id=?').all(fincaId),
    };
  },
  consultarInventario(fincaId, filtro) {
    return db.prepare('SELECT nombre, categoria, unidad, stock_actual, stock_minimo FROM productos WHERE finca_id=? AND activo=1 AND (? IS NULL OR nombre LIKE ?) ORDER BY nombre LIMIT 30').all(fincaId, filtro ?? null, `%${filtro ?? ''}%`);
  },
  consultarLabores(fincaId, filtro) {
    return db.prepare("SELECT l.tipo, l.estado, l.fecha_programada, lo.nombre lote FROM labores l JOIN lotes lo ON lo.id=l.lote_id WHERE l.finca_id=? AND l.estado IN ('pendiente','en_curso') AND (? IS NULL OR lo.nombre LIKE ? OR lo.codigo LIKE ?) ORDER BY l.fecha_programada LIMIT 30").all(fincaId, filtro ?? null, `%${filtro ?? ''}%`, `%${filtro ?? ''}%`);
  },
  consultarVentas(fincaId) {
    return db.prepare("SELECT numero, fecha, total FROM ventas WHERE finca_id=? AND estado='confirmada' ORDER BY fecha DESC LIMIT 10").all(fincaId);
  },
  /** Muestra SOLO lo registrado (producto, fecha, carencia). Jamás calcula ni sugiere dosis. */
  consultarAplicaciones(fincaId) {
    return db.prepare("SELECT producto_nombre, motivo, fecha_aplicacion, dosis_registrada, fecha_fin_carencia FROM aplicaciones_fito WHERE finca_id=? AND estado='aplicada' ORDER BY fecha_aplicacion DESC LIMIT 10").all(fincaId);
  },
};
