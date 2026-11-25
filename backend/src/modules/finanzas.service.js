import { db } from '../db/index.js';
import { round2 } from '../core/utils.js';

export const CATEGORIAS_COSTO = ['insumos', 'jornales', 'cosecha', 'vivero', 'mantenimiento', 'servicios', 'transporte', 'otros'];
const mes = (f) => f.slice(0, 7);

/**
 * Motor financiero. TODAS las cifras provienen de registros reales:
 *  - Costos de insumos: salidas de inventario con motivo "consumo" × costo promedio vigente al momento de la salida.
 *  - Costos de jornales: tabla jornales (jornadas × tarifa).
 *  - Otros costos: tabla gastos (cosecha, mantenimiento, servicios, transporte, vivero, otros).
 *  - Ingresos: líneas de ventas confirmadas (productos y plantines) + ingresos manuales (otros).
 * Atribución por cultivo: se usa la plantación explícita o, en su defecto, la plantación del lote vigente en la fecha del costo.
 */
export function calcularFinanzas(fincaId, filtros = {}) {
  const F = { desde: filtros.desde || null, hasta: filtros.hasta || null, lote_id: num(filtros.lote_id), cultivo_id: num(filtros.cultivo_id), producto_id: num(filtros.producto_id), trabajador_id: num(filtros.trabajador_id), categoria: filtros.categoria || null };
  const plantaciones = db.prepare('SELECT id, lote_id, cultivo_id, fecha_siembra FROM plantaciones WHERE finca_id=? ORDER BY fecha_siembra').all(fincaId);
  const plantacionEn = (loteId, fecha) => { let r = null; for (const p of plantaciones) if (p.lote_id === loteId && p.fecha_siembra <= fecha) r = p; return r; };
  const cultivoDe = (row) => { if (row.plantacion_id) return plantaciones.find(p => p.id === row.plantacion_id)?.cultivo_id ?? null; return row.lote_id ? plantacionEn(row.lote_id, row.fecha)?.cultivo_id ?? null : null; };

  // ---- costos ----
  const costos = [];
  for (const r of db.prepare(`SELECT m.fecha, m.lote_id, ROUND(m.cantidad * m.costo_unitario, 2) monto, m.producto_id, m.referencia_tipo FROM movimientos_inventario m
      WHERE m.finca_id=? AND m.tipo='salida' AND m.motivo='consumo'`).all(fincaId))
    costos.push({ fecha: r.fecha, lote_id: r.lote_id, categoria: r.referencia_tipo === 'siembra' ? 'vivero' : 'insumos', monto: r.monto, producto_id: r.producto_id });
  for (const r of db.prepare('SELECT fecha, lote_id, monto, trabajador_id, tipo FROM jornales WHERE finca_id=?').all(fincaId))
    costos.push({ fecha: r.fecha, lote_id: r.lote_id, categoria: r.tipo === 'cosecha' ? 'cosecha' : r.tipo === 'vivero' ? 'vivero' : 'jornales', monto: r.monto, trabajador_id: r.trabajador_id });
  for (const r of db.prepare('SELECT fecha, lote_id, plantacion_id, categoria, monto FROM gastos WHERE finca_id=?').all(fincaId))
    costos.push({ fecha: r.fecha, lote_id: r.lote_id, plantacion_id: r.plantacion_id, categoria: r.categoria, monto: r.monto });

  const okFecha = (f) => (!F.desde || f >= F.desde) && (!F.hasta || f <= F.hasta);
  const costosF = costos.filter(c => okFecha(c.fecha)
    && (!F.lote_id || c.lote_id === F.lote_id)
    && (!F.cultivo_id || cultivoDe(c) === F.cultivo_id)
    && (!F.producto_id || c.producto_id === F.producto_id)
    && (!F.trabajador_id || c.trabajador_id === F.trabajador_id)
    && (!F.categoria || c.categoria === F.categoria));

  // ---- ingresos ----
  const ingresos = [];
  for (const r of db.prepare(`SELECT v.fecha, d.subtotal monto, d.producto_id, d.siembra_id, co.lote_id, co.plantacion_id
      FROM detalle_venta d JOIN ventas v ON v.id=d.venta_id LEFT JOIN lotes_cosecha lc ON lc.id=d.lote_cosecha_id LEFT JOIN cosechas co ON co.id=lc.cosecha_id
      WHERE v.finca_id=? AND v.estado='confirmada'`).all(fincaId))
    ingresos.push({ fecha: r.fecha, monto: r.monto, tipo: r.siembra_id ? 'vivero' : 'ventas', lote_id: r.lote_id, plantacion_id: r.plantacion_id, producto_id: r.producto_id });
  const sinAtribuir = !!(F.lote_id || F.cultivo_id || F.producto_id);
  if (!sinAtribuir) for (const r of db.prepare('SELECT fecha, monto FROM ingresos WHERE finca_id=?').all(fincaId)) ingresos.push({ fecha: r.fecha, monto: r.monto, tipo: 'otros' });
  const ingF = (F.trabajador_id ? [] : ingresos).filter(i => okFecha(i.fecha)
    && (!F.lote_id || i.lote_id === F.lote_id)
    && (!F.cultivo_id || cultivoDe(i) === F.cultivo_id)
    && (!F.producto_id || i.producto_id === F.producto_id));

  const sumBy = (rows, key) => rows.reduce((a, r) => { a[r[key]] = round2((a[r[key]] || 0) + r.monto); return a; }, {});
  const ingTipo = sumBy(ingF, 'tipo'); const cosCat = sumBy(costosF, 'categoria');
  const totIng = round2(ingF.reduce((s, r) => s + r.monto, 0)); const totCos = round2(costosF.reduce((s, r) => s + r.monto, 0));
  const margen = round2(totIng - totCos);

  const lotes = db.prepare('SELECT id, codigo, nombre FROM lotes WHERE finca_id=?').all(fincaId);
  const cultivos = db.prepare('SELECT id, nombre, variedad FROM cultivos WHERE finca_id=?').all(fincaId);
  const agrupar = (items, key) => { const m = new Map(); for (const it of items) { const k = key(it); if (k == null) continue; m.set(k, [...(m.get(k) ?? []), it]); } return m; };
  const fila = (ing, cos) => { const i = round2(ing.reduce((s, r) => s + r.monto, 0)); const c = round2(cos.reduce((s, r) => s + r.monto, 0)); const m = round2(i - c);
    return { ingresos: i, costos: Object.fromEntries(CATEGORIAS_COSTO.map(k => [k, round2(cos.filter(r => r.categoria === k).reduce((s, r) => s + r.monto, 0))])), costo_total: c, margen: m, rentabilidad_pct: c > 0 ? round2(m / c * 100) : null }; };

  const ingPorLote = agrupar(ingF, r => r.lote_id); const cosPorLote = agrupar(costosF, r => r.lote_id);
  const porLote = lotes.filter(l => ingPorLote.has(l.id) || cosPorLote.has(l.id)).map(l => ({ lote_id: l.id, codigo: l.codigo, nombre: l.nombre, ...fila(ingPorLote.get(l.id) ?? [], cosPorLote.get(l.id) ?? []) })).sort((a, b) => b.margen - a.margen);
  const ingPorCult = agrupar(ingF, cultivoDe); const cosPorCult = agrupar(costosF, cultivoDe);
  const porCultivo = cultivos.filter(c => ingPorCult.has(c.id) || cosPorCult.has(c.id)).map(c => ({ cultivo_id: c.id, nombre: c.variedad ? `${c.nombre} ${c.variedad}` : c.nombre, ...fila(ingPorCult.get(c.id) ?? [], cosPorCult.get(c.id) ?? []) })).sort((a, b) => b.margen - a.margen);

  const meses = new Set([...ingF, ...costosF].map(r => mes(r.fecha)));
  const mensual = [...meses].sort().map(m => { const i = round2(ingF.filter(r => mes(r.fecha) === m).reduce((s, r) => s + r.monto, 0)); const c = round2(costosF.filter(r => mes(r.fecha) === m).reduce((s, r) => s + r.monto, 0)); return { mes: m, ingresos: i, costos: c, margen: round2(i - c) }; });

  const rango = (col) => `${F.desde ? ` AND ${col} >= '${F.desde}'` : ''}${F.hasta ? ` AND ${col} <= '${F.hasta}'` : ''}`;
  const cxc = db.prepare(`SELECT COALESCE(SUM(cc.saldo),0) s, COUNT(*) n FROM cuentas_por_cobrar cc JOIN ventas v ON v.id=cc.venta_id WHERE cc.finca_id=? AND cc.estado IN ('pendiente','parcial')${rango('v.fecha')}`).get(fincaId);
  const cobros = db.prepare(`SELECT COALESCE(SUM(monto),0) s FROM pagos_venta p WHERE finca_id=?${rango('p.fecha')} AND venta_id IN (SELECT id FROM ventas WHERE estado='confirmada')`).get(fincaId).s;
  const pagosTrab = db.prepare(`SELECT COALESCE(SUM(neto),0) s FROM pagos p WHERE finca_id=?${rango('p.fecha')}${F.trabajador_id ? ' AND trabajador_id=' + F.trabajador_id : ''}`).get(fincaId).s;

  return {
    filtros: F,
    resumen: {
      ingresos: { ventas: ingTipo.ventas || 0, vivero: ingTipo.vivero || 0, otros: ingTipo.otros || 0, total: totIng },
      costos: { ...Object.fromEntries(CATEGORIAS_COSTO.map(k => [k, cosCat[k] || 0])), total: totCos },
      margen_operativo: margen, margen_pct: totIng > 0 ? round2(margen / totIng * 100) : null,
      cuentas_por_cobrar: round2(cxc.s), cuentas_pendientes: cxc.n, cobros_recibidos: round2(cobros), pagos_a_trabajadores: round2(pagosTrab),
    },
    por_lote: porLote, por_cultivo: porCultivo, mensual,
  };
}

function num(v) { return v === undefined || v === null || v === '' ? null : Number(v); }

export function periodoAnterior(desde, hasta) {
  const d1 = new Date(desde + 'T00:00:00Z'), d2 = new Date(hasta + 'T00:00:00Z');
  const dias = Math.round((d2 - d1) / 86400000) + 1;
  const fin = new Date(d1); fin.setUTCDate(fin.getUTCDate() - 1);
  const ini = new Date(fin); ini.setUTCDate(ini.getUTCDate() - dias + 1);
  return { desde: ini.toISOString().slice(0, 10), hasta: fin.toISOString().slice(0, 10) };
}
const pct = (a, b) => (b ? round2((a - b) / Math.abs(b) * 100) : null);
export function compararPeriodos(fincaId, filtros, periodo2) {
  const actual = calcularFinanzas(fincaId, filtros);
  const prev = periodo2 ?? periodoAnterior(filtros.desde, filtros.hasta);
  const anterior = calcularFinanzas(fincaId, { ...filtros, ...prev });
  const a = actual.resumen, b = anterior.resumen;
  return { periodo_actual: { desde: filtros.desde, hasta: filtros.hasta }, periodo_anterior: prev, actual: a, anterior: b,
    variacion: { ingresos_pct: pct(a.ingresos.total, b.ingresos.total), costos_pct: pct(a.costos.total, b.costos.total), margen_pct: pct(a.margen_operativo, b.margen_operativo),
      ingresos_abs: round2(a.ingresos.total - b.ingresos.total), costos_abs: round2(a.costos.total - b.costos.total), margen_abs: round2(a.margen_operativo - b.margen_operativo) } };
}
