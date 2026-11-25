import { createApi } from '../core/api.js';
import { db } from '../db/index.js';
import { modulosActivos } from '../middleware/auth.js';
import { today, addDays, round2 } from '../core/utils.js';
import { eventosCalendario } from './campo.js';
import { alertasStock } from './inventario.js';
import { resumenAsistencia } from './trabajadores.js';
import { calcularFinanzas } from './finanzas.service.js';

export const dashboard = createApi('Dashboard y alertas', { prefix: '' });
const RIEGO_DIAS = Number(process.env.RIEGO_ALERTA_DIAS || 7);

const ctx = (req) => ({ f: req.user.fincaId, mods: new Set(modulosActivos(req.user.fincaId)), can: (p) => req.user.permisos.has(p) });
const SEV = { danger: 0, warning: 1, info: 2 };

export function construirAlertas(req) {
  const { f, mods, can } = ctx(req); const hoy = today(); const out = [];
  const push = (tipo, severidad, titulo, detalle, fecha, ruta) => out.push({ tipo, severidad, titulo, detalle, fecha: fecha ?? null, ruta });
  if (mods.has('M4') && can('inventario:read'))
    for (const p of alertasStock(f)) push('stock_bajo', p.stock_actual <= 0 ? 'danger' : 'warning', `Stock bajo: ${p.nombre}`, `Disponible ${p.stock_actual} ${p.unidad} (mínimo ${p.stock_minimo})`, null, '/inventario');
  if (mods.has('M1') && can('campo:read')) {
    for (const a of db.prepare(`SELECT a.id, a.producto_nombre, a.fecha_programada, lo.nombre lote FROM aplicaciones_fito a JOIN lotes lo ON lo.id=a.lote_id WHERE a.finca_id=? AND a.estado='pendiente' AND (a.fecha_programada IS NULL OR a.fecha_programada <= ?) ORDER BY a.fecha_programada`).all(f, addDays(hoy, 3)))
      push('aplicacion_pendiente', a.fecha_programada && a.fecha_programada < hoy ? 'danger' : 'warning', `Aplicación pendiente: ${a.producto_nombre}`, `${a.lote}${a.fecha_programada ? ' · programada ' + a.fecha_programada : ''}`, a.fecha_programada, '/campo');
    for (const a of db.prepare(`SELECT a.producto_nombre, a.fecha_fin_carencia, lo.nombre lote FROM aplicaciones_fito a JOIN lotes lo ON lo.id=a.lote_id WHERE a.finca_id=? AND a.estado='aplicada' AND a.fecha_fin_carencia >= ? ORDER BY a.fecha_fin_carencia`).all(f, hoy))
      push('carencia', 'warning', `Período de carencia vigente: ${a.lote}`, `${a.producto_nombre}: no cosechar para comercializar hasta ${a.fecha_fin_carencia}`, a.fecha_fin_carencia, '/campo');
    for (const l of db.prepare(`SELECT l.tipo, l.fecha_programada, lo.nombre lote FROM labores l JOIN lotes lo ON lo.id=l.lote_id WHERE l.finca_id=? AND l.estado IN ('pendiente','en_curso') AND l.fecha_programada < ? ORDER BY l.fecha_programada LIMIT 20`).all(f, hoy))
      push('labor_atrasada', 'danger', `Labor atrasada: ${l.tipo}`, `${l.lote} · programada ${l.fecha_programada}`, l.fecha_programada, '/campo');
    for (const p of db.prepare(`SELECT p.fecha_cosecha_estimada fecha, lo.nombre lote, cu.nombre cultivo FROM plantaciones p JOIN lotes lo ON lo.id=p.lote_id JOIN cultivos cu ON cu.id=p.cultivo_id WHERE p.finca_id=? AND p.estado='activo' AND p.fecha_cosecha_estimada BETWEEN ? AND ? ORDER BY fecha`).all(f, hoy, addDays(hoy, 14)))
      push('cosecha_proxima', 'info', `Cosecha próxima: ${p.cultivo}`, `${p.lote} · estimada ${p.fecha}`, p.fecha, '/campo');
    for (const p of db.prepare(`SELECT lo.nombre lote, cu.nombre cultivo, (SELECT MAX(r.fecha) FROM riegos r WHERE r.lote_id=p.lote_id) ultimo FROM plantaciones p JOIN lotes lo ON lo.id=p.lote_id JOIN cultivos cu ON cu.id=p.cultivo_id WHERE p.finca_id=? AND p.estado='activo'`).all(f))
      if (!p.ultimo || p.ultimo < addDays(hoy, -RIEGO_DIAS)) push('sin_riego', 'info', `Sin riego registrado: ${p.lote}`, p.ultimo ? `Último riego registrado: ${p.ultimo} (umbral de aviso: ${RIEGO_DIAS} días)` : 'No hay riegos registrados', p.ultimo, '/campo');
  }
  if (mods.has('M5') && can('ventas:read'))
    for (const c of db.prepare(`SELECT v.numero, cl.nombre cliente, cc.saldo, cc.fecha_vencimiento FROM cuentas_por_cobrar cc JOIN ventas v ON v.id=cc.venta_id JOIN clientes cl ON cl.id=cc.cliente_id WHERE cc.finca_id=? AND cc.saldo > 0 AND cc.fecha_vencimiento < ? ORDER BY cc.fecha_vencimiento`).all(f, hoy))
      push('cobro_vencido', 'danger', `Cobro vencido: ${c.numero}`, `${c.cliente} · saldo ${c.saldo} · venció ${c.fecha_vencimiento}`, c.fecha_vencimiento, '/ventas');
  return out.sort((a, b) => SEV[a.severidad] - SEV[b.severidad] || String(a.fecha ?? '9').localeCompare(String(b.fecha ?? '9')));
}
dashboard.get('/alertas', { summary: 'Alertas importantes (stock, aplicaciones, carencias, labores, cosechas, cobros)' }, (req) => construirAlertas(req));

dashboard.get('/dashboard', { summary: 'Indicadores, gráficos, actividad reciente, alertas y calendario del dashboard (datos reales, filtrados por permisos y módulos)' }, (req) => {
  const { f, mods, can } = ctx(req); const hoy = today();
  const hasta = req.query.hasta || hoy; const desde = req.query.desde || addDays(hasta, -29);
  const desde6m = addDays(hoy.slice(0, 8) + '01', -150).slice(0, 8) + '01';
  const campo = mods.has('M1') && can('campo:read');
  const out = { periodo: { desde, hasta }, modulos: [...mods], kpis: {}, graficos: {}, actividad: [], alertas: [], calendario: [], lotes: [], proximas_cosechas: [] };
  const k = out.kpis;
  k.lotes_total = db.prepare('SELECT COUNT(*) c FROM lotes WHERE finca_id=?').get(f).c;
  k.lotes_activos = db.prepare("SELECT COUNT(*) c FROM lotes WHERE finca_id=? AND estado='activo'").get(f).c;
  k.cultivos_activos = db.prepare("SELECT COUNT(*) c FROM plantaciones WHERE finca_id=? AND estado='activo'").get(f).c;
  if (campo) {
    k.produccion = db.prepare('SELECT unidad, ROUND(SUM(cantidad),2) cantidad FROM cosechas WHERE finca_id=? AND fecha BETWEEN ? AND ? GROUP BY unidad').all(f, desde, hasta);
    k.labores_pendientes = db.prepare("SELECT COUNT(*) c FROM labores WHERE finca_id=? AND estado IN ('pendiente','en_curso')").get(f).c;
    k.aplicaciones_pendientes = db.prepare("SELECT COUNT(*) c FROM aplicaciones_fito WHERE finca_id=? AND estado='pendiente'").get(f).c;
    out.proximas_cosechas = db.prepare(`SELECT p.id, p.fecha_cosecha_estimada fecha, lo.codigo lote_codigo, lo.nombre lote, cu.nombre cultivo FROM plantaciones p JOIN lotes lo ON lo.id=p.lote_id JOIN cultivos cu ON cu.id=p.cultivo_id
      WHERE p.finca_id=? AND p.estado='activo' AND p.fecha_cosecha_estimada >= ? ORDER BY p.fecha_cosecha_estimada LIMIT 6`).all(f, hoy);
    k.proximas_cosechas = out.proximas_cosechas.filter(c => c.fecha <= addDays(hoy, 30)).length;
    out.calendario = eventosCalendario(f, hoy, addDays(hoy, 14));
    out.graficos.produccion_mensual = db.prepare(`SELECT substr(c.fecha,1,7) mes, cu.nombre cultivo, ROUND(SUM(c.cantidad),2) cantidad, c.unidad FROM cosechas c JOIN plantaciones p ON p.id=c.plantacion_id JOIN cultivos cu ON cu.id=p.cultivo_id
      WHERE c.finca_id=? AND c.fecha >= ? GROUP BY mes, cu.nombre, c.unidad ORDER BY mes`).all(f, desde6m);
    out.lotes = db.prepare(`SELECT l.id, l.codigo, l.nombre, l.estado, l.superficie_ha, cu.nombre cultivo, p.fecha_cosecha_estimada,
      (SELECT COUNT(*) FROM labores lb WHERE lb.lote_id=l.id AND lb.estado IN ('pendiente','en_curso')) labores_pendientes,
      (SELECT ROUND(COALESCE(SUM(c.cantidad),0),2) FROM cosechas c WHERE c.lote_id=l.id) cosechado
      FROM lotes l LEFT JOIN plantaciones p ON p.lote_id=l.id AND p.estado='activo' LEFT JOIN cultivos cu ON cu.id=p.cultivo_id WHERE l.finca_id=? ORDER BY l.codigo`).all(f);
  } else out.lotes = db.prepare('SELECT id, codigo, nombre, estado, superficie_ha FROM lotes WHERE finca_id=? ORDER BY codigo').all(f);
  if (mods.has('M3') && can('trabajadores:read')) { k.trabajadores = db.prepare("SELECT COUNT(*) c FROM trabajadores WHERE finca_id=? AND estado='activo'").get(f).c; k.asistencia_hoy = resumenAsistencia(f, hoy); }
  if (mods.has('M4') && can('inventario:read')) {
    k.inventario_valor = db.prepare('SELECT ROUND(COALESCE(SUM(stock_actual*costo_promedio),0),2) v FROM productos WHERE finca_id=? AND activo=1').get(f).v;
    k.productos_stock_bajo = alertasStock(f).length;
  }
  if (mods.has('M5') && can('ventas:read')) {
    k.ventas_periodo = db.prepare("SELECT COUNT(*) cantidad, ROUND(COALESCE(SUM(total),0),2) total FROM ventas WHERE finca_id=? AND estado='confirmada' AND fecha BETWEEN ? AND ?").get(f, desde, hasta);
    k.cuentas_por_cobrar = db.prepare("SELECT ROUND(COALESCE(SUM(saldo),0),2) s FROM cuentas_por_cobrar WHERE finca_id=? AND estado IN ('pendiente','parcial')").get(f).s;
    out.graficos.ventas_mensual = db.prepare("SELECT substr(fecha,1,7) mes, ROUND(SUM(total),2) total, COUNT(*) cantidad FROM ventas WHERE finca_id=? AND estado='confirmada' AND fecha >= ? GROUP BY mes ORDER BY mes").all(f, desde6m);
  }
  if (mods.has('M7') && can('finanzas:read')) {
    const fin = calcularFinanzas(f, { desde, hasta });
    k.ingresos = fin.resumen.ingresos.total; k.costos = fin.resumen.costos.total; k.margen = fin.resumen.margen_operativo; k.margen_pct = fin.resumen.margen_pct;
    out.graficos.ingresos_vs_costos = calcularFinanzas(f, { desde: desde6m, hasta: hoy }).mensual;
    out.graficos.costos_por_categoria = Object.entries(fin.resumen.costos).filter(([c, v]) => c !== 'total' && v > 0).map(([categoria, monto]) => ({ categoria, monto }));
  }
  out.alertas = construirAlertas(req).slice(0, 8);
  const act = [];
  if (campo) {
    for (const r of db.prepare(`SELECT l.tipo, lo.nombre lote, COALESCE(l.fecha_realizada, l.fecha_programada) fecha, l.estado FROM labores l JOIN lotes lo ON lo.id=l.lote_id WHERE l.finca_id=? ORDER BY l.id DESC LIMIT 6`).all(f)) act.push({ fecha: r.fecha, tipo: 'labor', texto: `Labor ${r.tipo} en ${r.lote} (${r.estado})` });
    for (const r of db.prepare(`SELECT c.fecha, c.cantidad, c.unidad, lo.nombre lote, cu.nombre cultivo FROM cosechas c JOIN lotes lo ON lo.id=c.lote_id JOIN plantaciones p ON p.id=c.plantacion_id JOIN cultivos cu ON cu.id=p.cultivo_id WHERE c.finca_id=? ORDER BY c.id DESC LIMIT 6`).all(f)) act.push({ fecha: r.fecha, tipo: 'cosecha', texto: `Cosecha de ${r.cultivo}: ${r.cantidad} ${r.unidad} en ${r.lote}` });
  }
  if (mods.has('M5') && can('ventas:read'))
    for (const r of db.prepare(`SELECT v.fecha, v.numero, v.total, c.nombre FROM ventas v JOIN clientes c ON c.id=v.cliente_id WHERE v.finca_id=? AND v.estado='confirmada' ORDER BY v.id DESC LIMIT 6`).all(f)) act.push({ fecha: r.fecha, tipo: 'venta', texto: `Venta ${r.numero} a ${r.nombre}: ${r.total}` });
  out.actividad = act.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 10);
  return out;
});
