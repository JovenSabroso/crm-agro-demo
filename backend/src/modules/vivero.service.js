import { db } from '../db/index.js';

/** SQL reutilizable: contadores derivados del libro de movimientos del vivero. */
export const SIEMBRA_STATS_SQL = `
  COALESCE((SELECT SUM(cantidad) FROM movimientos_vivero m WHERE m.siembra_id = s.id AND m.tipo = 'germinacion'), 0) AS germinadas,
  COALESCE((SELECT SUM(cantidad) FROM movimientos_vivero m WHERE m.siembra_id = s.id AND m.tipo = 'perdida'), 0) AS perdidas,
  COALESCE((SELECT SUM(cantidad) FROM movimientos_vivero m WHERE m.siembra_id = s.id AND m.tipo = 'venta'), 0) AS vendidas,
  COALESCE((SELECT SUM(cantidad) FROM movimientos_vivero m WHERE m.siembra_id = s.id AND m.tipo = 'trasplante'), 0) AS trasplantadas`;

export function estadoSiembra(siembraId) {
  const r = db.prepare(`SELECT s.id, s.cantidad_sembrada, ${SIEMBRA_STATS_SQL} FROM siembras_vivero s WHERE s.id = ?`).get(siembraId);
  if (!r) return null;
  // existentes = plantines vivos producidos (germinados − pérdidas); disponibles = existentes que no se vendieron ni trasplantaron
  const existentes = r.germinadas - r.perdidas;
  return { ...r, existentes, disponibles: existentes - r.vendidas - r.trasplantadas, tasa_germinacion: r.cantidad_sembrada ? Math.round((r.germinadas / r.cantidad_sembrada) * 1000) / 10 : 0 };
}
