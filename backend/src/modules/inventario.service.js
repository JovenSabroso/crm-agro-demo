import { db, tx } from '../db/index.js';
import { round2, round3, today } from '../core/utils.js';
import { badRequest, conflict, unprocessable, notFound } from '../core/errors.js';

/** Stock de un lote de cosecha = suma de deltas de sus movimientos. */
export function stockLoteCosecha(loteCosechaId) {
  return round3(db.prepare('SELECT COALESCE(SUM(delta),0) s FROM movimientos_inventario WHERE lote_cosecha_id = ?').get(loteCosechaId).s);
}

/**
 * Único punto de entrada para modificar existencias. Transaccional:
 *  - valida finca, impide stock negativo (también por lote de cosecha)
 *  - recalcula costo promedio ponderado en entradas
 *  - evita duplicados mediante clave_idempotencia
 * Debe invocarse dentro de tx() cuando forme parte de una operación mayor (es seguro llamarlo anidado).
 */
export function moverStock({
  fincaId, productoId, tipo, motivo, cantidad, cantidadReal, costoUnitario, fecha, proveedorId = null,
  loteId = null, loteCosechaId = null, referenciaTipo = null, referenciaId = null, claveIdempotencia = null, usuarioId = null, observaciones = null,
}) {
  return tx(() => {
    const prod = db.prepare('SELECT * FROM productos WHERE id = ? AND finca_id = ?').get(productoId, fincaId);
    if (!prod) throw badRequest('Producto inexistente en esta finca');
    if (!prod.activo) throw unprocessable(`El producto "${prod.nombre}" está inactivo`);

    if (claveIdempotencia) {
      const dup = db.prepare('SELECT id FROM movimientos_inventario WHERE finca_id = ? AND clave_idempotencia = ?').get(fincaId, claveIdempotencia);
      if (dup) throw conflict('Movimiento duplicado: esta operación ya fue registrada', { movimiento_id: dup.id });
    }
    if (loteCosechaId) {
      const lc = db.prepare('SELECT id, producto_id FROM lotes_cosecha WHERE id = ? AND finca_id = ?').get(loteCosechaId, fincaId);
      if (!lc) throw badRequest('Lote de cosecha inexistente en esta finca');
    }
    if (loteId && !db.prepare('SELECT 1 FROM lotes WHERE id = ? AND finca_id = ?').get(loteId, fincaId)) throw badRequest('Lote inexistente en esta finca');

    let delta;
    if (tipo === 'ajuste') {
      const base = loteCosechaId ? stockLoteCosecha(loteCosechaId) : prod.stock_actual;
      delta = round3(Number(cantidadReal) - base);
      if (delta === 0) throw unprocessable('El ajuste no cambia el stock (la cantidad real coincide con la registrada)');
    } else {
      const c = round3(cantidad);
      if (!(c > 0)) throw badRequest('La cantidad debe ser mayor que cero');
      delta = tipo === 'entrada' ? c : -c;
    }
    const qty = Math.abs(delta);

    if (delta < 0) {
      if (prod.stock_actual + delta < -1e-9) throw unprocessable(`Stock insuficiente de "${prod.nombre}": disponible ${round3(prod.stock_actual)} ${prod.unidad}, solicitado ${qty}`);
      if (loteCosechaId) {
        const disp = stockLoteCosecha(loteCosechaId);
        if (disp + delta < -1e-9) throw unprocessable(`Stock insuficiente en el lote de cosecha: disponible ${disp} ${prod.unidad}, solicitado ${qty}`);
      }
    }

    const nuevoStock = round3(prod.stock_actual + delta);
    let costoProm = prod.costo_promedio;
    // Salidas se valorizan al costo promedio vigente; entradas al costo informado (o al promedio si no se informa).
    const costo = delta < 0 ? prod.costo_promedio : (costoUnitario ?? prod.costo_promedio);
    if (delta > 0 && tipo === 'entrada' && costo > 0) {
      costoProm = round2(((prod.stock_actual * prod.costo_promedio) + qty * costo) / (prod.stock_actual + qty));
    }

    db.prepare('UPDATE productos SET stock_actual = ?, costo_promedio = ? WHERE id = ?').run(nuevoStock, costoProm, productoId);
    const info = db.prepare(`INSERT INTO movimientos_inventario
      (finca_id, producto_id, tipo, motivo, cantidad, delta, stock_resultante, costo_unitario, fecha, proveedor_id, lote_id, lote_cosecha_id, referencia_tipo, referencia_id, clave_idempotencia, usuario_id, observaciones)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(fincaId, productoId, tipo, motivo, qty, delta, nuevoStock, costo, fecha || today(), proveedorId, loteId, loteCosechaId, referenciaTipo, referenciaId, claveIdempotencia, usuarioId, observaciones);
    return db.prepare('SELECT * FROM movimientos_inventario WHERE id = ?').get(info.lastInsertRowid);
  });
}

export function getProducto(id, fincaId) {
  const p = db.prepare('SELECT * FROM productos WHERE id = ? AND finca_id = ?').get(id, fincaId);
  if (!p) throw notFound('Producto no encontrado');
  return p;
}
