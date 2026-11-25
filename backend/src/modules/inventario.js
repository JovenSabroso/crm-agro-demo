import { createApi, Page } from '../core/api.js';
import { crud, assertOwned } from '../core/crud.js';
import { z, str, optStr, optNum, optInt, optDate, optId, id, enm, bool, listQuery, optEmail } from '../core/schemas.js';
import { db, tx } from '../db/index.js';
import { notFound, unprocessable, badRequest } from '../core/errors.js';
import { audit } from '../core/audit.js';
import { today } from '../core/utils.js';
import { moverStock, stockLoteCosecha } from './inventario.service.js';

const M = 'M4';
export const CATEGORIAS = ['semillas', 'fertilizantes', 'agroquimicos', 'herramientas', 'materiales', 'productos_cosechados', 'plantines'];

// ---------- Proveedores ----------
export const proveedores = createApi('M4 · Proveedores', { prefix: '/proveedores', module: M });
crud(proveedores, {
  name: 'proveedor', table: 'proveedores', perm: 'inventario',
  create: z.object({ nombre: str(120), contacto: optStr(100), telefono: optStr(30), email: optEmail(), direccion: optStr(200) }),
  search: ['x.nombre', 'x.contacto', 'x.telefono'], sorts: { nombre: 'x.nombre' }, defaultSort: 'nombre ASC',
});

// ---------- Productos ----------
export const productos = createApi('M4 · Productos', { prefix: '/productos', module: M });
const prodBase = {
  categoria: enm(CATEGORIAS), nombre: str(120), unidad: str(15).default('kg'), stock_minimo: optNum({ min: 0 }).transform(v => v ?? 0),
  precio_venta: optNum({ min: 0 }), proveedor_id: optId(), periodo_carencia_dias: optInt({ min: 0, max: 365 }), etiqueta_info: optStr(500), activo: bool().optional(),
};
crud(productos, {
  name: 'producto', table: 'productos', perm: 'inventario', skip: ['post'],
  create: z.object(prodBase), update: z.object(prodBase).omit({ categoria: true }).partial(),
  owned: { proveedor_id: 'proveedores' },
  select: "pr.nombre AS proveedor_nombre, (x.stock_actual <= x.stock_minimo AND x.stock_minimo > 0) AS bajo_stock, ROUND(x.stock_actual * x.costo_promedio, 2) AS valor_stock",
  joins: 'LEFT JOIN proveedores pr ON pr.id = x.proveedor_id',
  search: ['x.nombre', 'pr.nombre'], filters: { categoria: 'x.categoria', activo: 'x.activo', proveedor_id: 'x.proveedor_id' },
  flags: { bajo_stock: 'x.stock_actual <= x.stock_minimo AND x.stock_minimo > 0', con_stock: 'x.stock_actual > 0' },
  sorts: { nombre: 'x.nombre', stock: 'x.stock_actual', categoria: 'x.categoria', valor: 'x.stock_actual * x.costo_promedio' }, defaultSort: 'nombre ASC',
});
productos.post('/', {
  summary: 'Registrar producto/insumo (opcionalmente con existencia inicial)', perm: 'inventario:write',
  body: z.object({ ...prodBase, stock_inicial: optNum({ min: 0 }), costo_unitario: optNum({ min: 0 }) }),
}, (req) => tx(() => {
  const { stock_inicial, costo_unitario, ...b } = req.body;
  if (b.categoria === 'productos_cosechados' && stock_inicial > 0) throw unprocessable('Los productos cosechados ingresan al inventario desde una cosecha (para conservar la trazabilidad)');
  if (b.proveedor_id) assertOwned('proveedores', b.proveedor_id, req.user.fincaId, 'proveedor_id');
  const info = db.prepare(`INSERT INTO productos (finca_id, categoria, nombre, unidad, stock_minimo, precio_venta, proveedor_id, periodo_carencia_dias, etiqueta_info, activo)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(req.user.fincaId, b.categoria, b.nombre, b.unidad, b.stock_minimo ?? 0, b.precio_venta ?? null, b.proveedor_id ?? null, b.periodo_carencia_dias ?? null, b.etiqueta_info ?? null, b.activo ?? 1);
  if (stock_inicial > 0) moverStock({ fincaId: req.user.fincaId, productoId: info.lastInsertRowid, tipo: 'entrada', motivo: 'compra', cantidad: stock_inicial, costoUnitario: costo_unitario ?? 0, proveedorId: b.proveedor_id ?? null, usuarioId: req.user.id, observaciones: 'Existencia inicial' });
  audit(req, { accion: 'crear', entidad: 'productos', id: info.lastInsertRowid, detalle: { nombre: b.nombre, categoria: b.categoria } });
  return db.prepare('SELECT * FROM productos WHERE id = ?').get(info.lastInsertRowid);
}));

// ---------- Inventario: movimientos, disponibilidad y alertas ----------
export const inventario = createApi('M4 · Inventario', { prefix: '/inventario', module: M });

const movBody = z.object({
  producto_id: id(), tipo: enm(['entrada', 'salida', 'ajuste']), motivo: optStr(30),
  cantidad: optNum({ gt: 0 }), cantidad_real: optNum({ min: 0 }), costo_unitario: optNum({ min: 0 }), fecha: optDate(),
  proveedor_id: optId(), lote_id: optId(), lote_cosecha_id: optId(), clave_idempotencia: optStr(80), observaciones: optStr(300),
}).superRefine((d, ctx) => {
  if (d.tipo === 'ajuste' && d.cantidad_real == null) ctx.addIssue({ code: 'custom', path: ['cantidad_real'], message: 'Indica la cantidad real contada para el ajuste' });
  if (d.tipo !== 'ajuste' && d.cantidad == null) ctx.addIssue({ code: 'custom', path: ['cantidad'], message: 'Indica la cantidad' });
});
const MOTIVOS = { entrada: ['compra', 'devolucion', 'donacion', 'otro'], salida: ['consumo', 'merma', 'otro'], ajuste: ['ajuste'] };

inventario.post('/movimientos', { summary: 'Registrar entrada, salida o ajuste de inventario', perm: 'inventario:write', body: movBody }, (req) => {
  const b = req.body; const fincaId = req.user.fincaId;
  const prod = assertOwned('productos', b.producto_id, fincaId, 'producto_id');
  const motivo = b.motivo || MOTIVOS[b.tipo][0];
  if (!MOTIVOS[b.tipo].includes(motivo)) throw badRequest(`Motivo inválido para ${b.tipo}. Opciones: ${MOTIVOS[b.tipo].join(', ')}`);
  if (b.proveedor_id) assertOwned('proveedores', b.proveedor_id, fincaId, 'proveedor_id');
  if (prod.categoria === 'productos_cosechados') {
    if (b.tipo === 'entrada') throw unprocessable('Las entradas de productos cosechados se registran desde la cosecha (Control de campo → Cosechas → Ingresar al inventario)');
    if (!b.lote_cosecha_id) throw unprocessable('Indica el lote de cosecha afectado (los productos cosechados se controlan por lote de cosecha)');
    const lc = assertOwned('lotes_cosecha', b.lote_cosecha_id, fincaId, 'lote_cosecha_id');
    if (lc.producto_id !== prod.id) throw unprocessable('El lote de cosecha no corresponde a este producto');
  } else if (b.lote_cosecha_id) throw badRequest('lote_cosecha_id solo aplica a productos cosechados');
  const mov = moverStock({ fincaId, productoId: b.producto_id, tipo: b.tipo, motivo, cantidad: b.cantidad, cantidadReal: b.cantidad_real, costoUnitario: b.costo_unitario ?? undefined,
    fecha: b.fecha || today(), proveedorId: b.proveedor_id ?? null, loteId: b.lote_id ?? null, loteCosechaId: b.lote_cosecha_id ?? null, claveIdempotencia: b.clave_idempotencia ?? null, usuarioId: req.user.id, observaciones: b.observaciones ?? null });
  audit(req, { accion: `inventario_${b.tipo}`, entidad: 'movimientos_inventario', id: mov.id, detalle: { producto: prod.nombre, delta: mov.delta, motivo } });
  return mov;
});

inventario.get('/movimientos', { summary: 'Historial de movimientos de inventario', perm: 'inventario:read', query: listQuery }, (req) => {
  const q = req.q; const where = ['m.finca_id = ?']; const args = [req.user.fincaId];
  for (const k of ['producto_id', 'tipo', 'motivo', 'lote_cosecha_id', 'lote_id']) if (q[k]) { where.push(`m.${k} = ?`); args.push(q[k]); }
  if (q.categoria) { where.push('p.categoria = ?'); args.push(q.categoria); }
  if (q.q) { where.push('(p.nombre LIKE ? OR m.observaciones LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
  if (q.desde) { where.push('m.fecha >= ?'); args.push(q.desde); } if (q.hasta) { where.push('m.fecha <= ?'); args.push(q.hasta); }
  const from = 'movimientos_inventario m JOIN productos p ON p.id=m.producto_id LEFT JOIN proveedores pv ON pv.id=m.proveedor_id LEFT JOIN lotes_cosecha lc ON lc.id=m.lote_cosecha_id LEFT JOIN lotes lo ON lo.id=m.lote_id LEFT JOIN usuarios u ON u.id=m.usuario_id';
  const total = db.prepare(`SELECT COUNT(*) c FROM ${from} WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`SELECT m.*, p.nombre producto_nombre, p.unidad, p.categoria, pv.nombre proveedor_nombre, lc.codigo lote_cosecha_codigo, lo.nombre lote_nombre, u.nombre usuario_nombre
    FROM ${from} WHERE ${where.join(' AND ')} ORDER BY m.fecha DESC, m.id DESC LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize);
  return new Page(rows, { page: q.page, pageSize: q.pageSize, total });
});

inventario.get('/disponibilidad', { summary: 'Consulta de disponibilidad (con desglose por lote de cosecha)', perm: 'inventario:read' }, (req) => {
  const where = ['p.finca_id = ?', 'p.activo = 1']; const args = [req.user.fincaId];
  if (req.query.q) { where.push('p.nombre LIKE ?'); args.push(`%${req.query.q}%`); }
  if (req.query.categoria) { where.push('p.categoria = ?'); args.push(req.query.categoria); }
  if (req.query.solo_con_stock !== '0') where.push('p.stock_actual > 0');
  const prods = db.prepare(`SELECT p.id, p.nombre, p.categoria, p.unidad, p.stock_actual, p.stock_minimo, p.precio_venta, p.costo_promedio FROM productos p WHERE ${where.join(' AND ')} ORDER BY p.nombre`).all(...args);
  return prods.map(p => p.categoria === 'productos_cosechados' ? { ...p, lotes: lotesDisponibles(req.user.fincaId, p.id) } : p);
});

/** Lotes de cosecha con stock disponible (FIFO por fecha de cosecha). */
export function lotesDisponibles(fincaId, productoId, { soloComercializables = false } = {}) {
  return db.prepare(`SELECT lc.id lote_cosecha_id, lc.codigo, c.fecha, c.comercializable, c.unidad, lo.nombre lote_nombre,
      ROUND(COALESCE(SUM(m.delta),0), 3) disponible
    FROM lotes_cosecha lc JOIN cosechas c ON c.id=lc.cosecha_id JOIN lotes lo ON lo.id=c.lote_id LEFT JOIN movimientos_inventario m ON m.lote_cosecha_id=lc.id
    WHERE lc.finca_id=? AND lc.producto_id=? ${soloComercializables ? 'AND c.comercializable=1' : ''}
    GROUP BY lc.id HAVING disponible > 0 ORDER BY c.fecha, lc.id`).all(fincaId, productoId);
}
inventario.get('/lotes-disponibles', { summary: 'Lotes de cosecha con stock disponible para un producto', perm: 'inventario:read' }, (req) => {
  const pid = Number(req.query.producto_id); if (!pid) throw badRequest('producto_id es requerido');
  assertOwned('productos', pid, req.user.fincaId, 'producto_id');
  return lotesDisponibles(req.user.fincaId, pid, { soloComercializables: req.query.comercializables === '1' });
});

export function alertasStock(fincaId) {
  return db.prepare(`SELECT id, nombre, categoria, unidad, stock_actual, stock_minimo FROM productos
    WHERE finca_id=? AND activo=1 AND stock_minimo > 0 AND stock_actual <= stock_minimo ORDER BY (stock_actual*1.0/stock_minimo), nombre`).all(fincaId);
}
inventario.get('/alertas', { summary: 'Productos con stock en o bajo el mínimo', perm: 'inventario:read' }, (req) => alertasStock(req.user.fincaId));

inventario.get('/resumen', { summary: 'Resumen de inventario por categoría (valorizado)', perm: 'inventario:read' }, (req) => {
  const porCategoria = db.prepare(`SELECT categoria, COUNT(*) productos, ROUND(SUM(stock_actual*costo_promedio),2) valor, SUM(stock_minimo > 0 AND stock_actual <= stock_minimo) bajo_stock
    FROM productos WHERE finca_id=? AND activo=1 GROUP BY categoria ORDER BY categoria`).all(req.user.fincaId);
  return { por_categoria: porCategoria, valor_total: Math.round(porCategoria.reduce((s, r) => s + (r.valor || 0), 0) * 100) / 100, bajo_stock: porCategoria.reduce((s, r) => s + (r.bajo_stock || 0), 0) };
});
export { stockLoteCosecha };
