import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { createApi } from '../core/api.js';
import { crud } from '../core/crud.js';
import { z, str, optStr, optDate, date, enm, optId, id } from '../core/schemas.js';
import { db } from '../db/index.js';
import { today } from '../core/utils.js';
import { calcularFinanzas, compararPeriodos, CATEGORIAS_COSTO } from './finanzas.service.js';

const M = 'M7';
export const finanzas = createApi('M7 · Finanzas y reportes', { prefix: '/finanzas', module: M });

const filtros = z.object({ desde: z.string().optional(), hasta: z.string().optional(), lote_id: z.string().optional(), cultivo_id: z.string().optional(), producto_id: z.string().optional(), trabajador_id: z.string().optional(), categoria: z.string().optional(), formato: z.string().optional(), desde2: z.string().optional(), hasta2: z.string().optional() });

finanzas.get('/resumen', { summary: 'Resumen financiero con costos/ingresos por categoría, lote y cultivo (filtrable)', perm: 'finanzas:read', query: filtros }, (req) => calcularFinanzas(req.user.fincaId, req.q));
finanzas.get('/por-lote', { summary: 'Costos, ingresos y rentabilidad por lote', perm: 'finanzas:read', query: filtros }, (req) => calcularFinanzas(req.user.fincaId, req.q).por_lote);
finanzas.get('/por-cultivo', { summary: 'Rentabilidad por cultivo', perm: 'finanzas:read', query: filtros }, (req) => calcularFinanzas(req.user.fincaId, req.q).por_cultivo);
finanzas.get('/comparacion', { summary: 'Comparación de períodos (por defecto contra el período inmediatamente anterior de igual duración)', perm: 'finanzas:read', query: filtros }, (req) => {
  const q = req.q; const hasta = q.hasta || today(); const desde = q.desde || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  return compararPeriodos(req.user.fincaId, { ...q, desde, hasta }, q.desde2 && q.hasta2 ? { desde: q.desde2, hasta: q.hasta2 } : undefined);
});

// ---- Exportación ----
finanzas.get('/exportar', { summary: 'Exportar reporte financiero a Excel (formato=xlsx) o PDF (formato=pdf)', perm: 'finanzas:read', query: filtros, raw: true }, async (req, res) => {
  const f = db.prepare('SELECT nombre, moneda FROM fincas WHERE id=?').get(req.user.fincaId);
  const d = calcularFinanzas(req.user.fincaId, req.q); const r = d.resumen;
  const rango = `${req.q.desde || 'inicio'} a ${req.q.hasta || 'hoy'}`;
  if (req.q.formato === 'pdf') {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="reporte-financiero.pdf"' });
    doc.pipe(res);
    doc.fontSize(18).fillColor('#1f5130').text('CRM-Agro · Reporte financiero'); doc.fontSize(10).fillColor('#444').text(`${f.nombre} · Período: ${rango} · Moneda: ${f.moneda}`).moveDown();
    const linea = (k, v, bold) => { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#000').text(k, 48, doc.y, { continued: true, width: 300 }).text(Number(v).toFixed(2), { align: 'right', width: 150 }); };
    doc.font('Helvetica-Bold').fontSize(12).text('Ingresos'); linea('Ventas', r.ingresos.ventas); linea('Vivero', r.ingresos.vivero); linea('Otros', r.ingresos.otros); linea('Total ingresos', r.ingresos.total, true);
    doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Costos'); CATEGORIAS_COSTO.forEach(k => linea(k[0].toUpperCase() + k.slice(1), r.costos[k])); linea('Total costos', r.costos.total, true);
    doc.moveDown(); linea('MARGEN OPERATIVO', r.margen_operativo, true); doc.font('Helvetica').text(`Cuentas por cobrar: ${r.cuentas_por_cobrar.toFixed(2)}   Cobros recibidos: ${r.cobros_recibidos.toFixed(2)}   Pagos a trabajadores: ${r.pagos_a_trabajadores.toFixed(2)}`);
    const tabla = (titulo, rows, nombre) => { doc.moveDown().font('Helvetica-Bold').fontSize(12).text(titulo); doc.font('Helvetica').fontSize(9);
      rows.forEach(x => doc.text(`${nombre(x)}   Ingresos ${x.ingresos.toFixed(2)}   Costos ${x.costo_total.toFixed(2)}   Margen ${x.margen.toFixed(2)}   Rent. ${x.rentabilidad_pct ?? '—'}%`)); };
    tabla('Rentabilidad por lote', d.por_lote, x => `${x.codigo} ${x.nombre}`); tabla('Rentabilidad por cultivo', d.por_cultivo, x => x.nombre);
    doc.end(); return;
  }
  const wb = new ExcelJS.Workbook(); wb.creator = 'CRM-Agro';
  const ws = wb.addWorksheet('Resumen'); ws.columns = [{ width: 34 }, { width: 16 }];
  ws.addRow([`Reporte financiero — ${f.nombre}`]).font = { bold: true, size: 14 }; ws.addRow([`Período: ${rango}`, f.moneda]); ws.addRow([]);
  const add = (k, v, b) => { const row = ws.addRow([k, v]); if (b) row.font = { bold: true }; row.getCell(2).numFmt = '#,##0.00'; };
  add('Ingresos por ventas', r.ingresos.ventas); add('Ingresos por vivero', r.ingresos.vivero); add('Otros ingresos', r.ingresos.otros); add('TOTAL INGRESOS', r.ingresos.total, true);
  CATEGORIAS_COSTO.forEach(k => add(`Costo: ${k}`, r.costos[k])); add('TOTAL COSTOS', r.costos.total, true); add('MARGEN OPERATIVO', r.margen_operativo, true);
  add('Cuentas por cobrar', r.cuentas_por_cobrar); add('Cobros recibidos', r.cobros_recibidos); add('Pagos a trabajadores', r.pagos_a_trabajadores);
  const hoja = (nombre, rows, label) => { const s = wb.addWorksheet(nombre); s.columns = [{ header: label, width: 28 }, { header: 'Ingresos', width: 14 }, ...CATEGORIAS_COSTO.map(c => ({ header: c, width: 13 })), { header: 'Costo total', width: 14 }, { header: 'Margen', width: 14 }, { header: 'Rentabilidad %', width: 15 }];
    s.getRow(1).font = { bold: true }; rows.forEach(x => s.addRow([label === 'Lote' ? `${x.codigo} ${x.nombre}` : x.nombre, x.ingresos, ...CATEGORIAS_COSTO.map(c => x.costos[c]), x.costo_total, x.margen, x.rentabilidad_pct])); };
  hoja('Por lote', d.por_lote, 'Lote'); hoja('Por cultivo', d.por_cultivo, 'Cultivo');
  const sm = wb.addWorksheet('Mensual'); sm.columns = [{ header: 'Mes', width: 12 }, { header: 'Ingresos', width: 14 }, { header: 'Costos', width: 14 }, { header: 'Margen', width: 14 }]; sm.getRow(1).font = { bold: true }; d.mensual.forEach(m => sm.addRow([m.mes, m.ingresos, m.costos, m.margen]));
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="reporte-financiero.xlsx"' });
  await wb.xlsx.write(res); res.end();
});

// ---- Gastos e ingresos manuales ----
export const gastos = createApi('M7 · Gastos', { prefix: '/gastos', module: M });
const gastoBase = { fecha: date(), categoria: enm(['cosecha', 'mantenimiento', 'servicios', 'transporte', 'vivero', 'otros']), descripcion: str(200), monto: z.coerce.number().gt(0), lote_id: optId(), plantacion_id: optId(), siembra_id: optId(), proveedor_id: optId() };
crud(gastos, {
  name: 'gasto', table: 'gastos', perm: 'finanzas', create: z.object(gastoBase), update: z.object(gastoBase).partial(),
  owned: { lote_id: 'lotes', plantacion_id: 'plantaciones', siembra_id: 'siembras_vivero', proveedor_id: 'proveedores' },
  select: 'lo.nombre AS lote_nombre', joins: 'LEFT JOIN lotes lo ON lo.id = x.lote_id',
  search: ['x.descripcion'], filters: { categoria: 'x.categoria', lote_id: 'x.lote_id' }, dateField: 'x.fecha', sorts: { fecha: 'x.fecha', monto: 'x.monto' }, defaultSort: 'fecha DESC',
});
export const ingresos = createApi('M7 · Ingresos', { prefix: '/ingresos', module: M });
const ingBase = { fecha: date(), categoria: str(40).default('otros'), descripcion: str(200), monto: z.coerce.number().gt(0) };
crud(ingresos, { name: 'ingreso', table: 'ingresos', perm: 'finanzas', create: z.object(ingBase), update: z.object(ingBase).partial(), search: ['x.descripcion'], dateField: 'x.fecha', sorts: { fecha: 'x.fecha', monto: 'x.monto' }, defaultSort: 'fecha DESC' });
