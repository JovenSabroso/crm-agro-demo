import { db, tx } from '../db/index.js';
import { assertOwned } from '../core/crud.js';
import { badRequest, notFound, unprocessable } from '../core/errors.js';
import { audit } from '../core/audit.js';
import { today, round2, round3, pad } from '../core/utils.js';
import { moverStock } from './inventario.service.js';
import { verificarCarencia } from './campo.js';
import { estadoSiembra } from './vivero.service.js';

const nextNumero = (fincaId) => {
  const n = db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(numero, 3) AS INTEGER)), 0) n FROM ventas WHERE finca_id = ?").get(fincaId).n;
  return `V-${pad(n + 1, 6)}`;
};

/** Lotes de cosecha vendibles (comercializables y con stock) en orden FIFO. */
function lotesVendibles(fincaId, productoId) {
  return db.prepare(`SELECT lc.id, lc.codigo, c.lote_id, c.plantacion_id, c.fecha,
      ROUND(COALESCE(SUM(m.delta),0),3) disponible
    FROM lotes_cosecha lc JOIN cosechas c ON c.id=lc.cosecha_id LEFT JOIN movimientos_inventario m ON m.lote_cosecha_id=lc.id
    WHERE lc.finca_id=? AND lc.producto_id=? AND c.comercializable=1 GROUP BY lc.id HAVING disponible > 0 ORDER BY c.fecha, lc.id`).all(fincaId, productoId);
}

function exigirVendible(lc) {
  const inc = verificarCarencia(lc.plantacion_id, lc.lote_id, lc.fecha);
  if (inc.length) throw unprocessable(`El lote ${lc.codigo} incumple el período de carencia de "${inc[0].producto_nombre}" y no puede venderse`);
}

/** Convierte los ítems solicitados en líneas de detalle (asignando lotes de cosecha FIFO cuando corresponde). */
function expandirItems(items, fincaId) {
  const reservado = new Map();       // lote_cosecha_id → cantidad ya asignada en esta venta
  const lines = [];
  for (const it of items) {
    const descuento = round2(it.descuento ?? 0);
    if (it.siembra_id) {
      const s = db.prepare(`SELECT s.*, e.nombre, e.variedad, e.precio_plantin FROM siembras_vivero s JOIN especies e ON e.id = s.especie_id WHERE s.id = ? AND s.finca_id = ?`).get(it.siembra_id, fincaId);
      if (!s) throw badRequest('Siembra de vivero inexistente en esta finca');
      const precio = it.precio_unitario ?? s.precio_plantin;
      if (precio == null) throw badRequest(`Indica el precio unitario de los plantines de ${s.nombre}`);
      lines.push({ siembra_id: s.id, descripcion: `Plantines ${s.nombre}${s.variedad ? ' ' + s.variedad : ''} (${s.codigo})`, cantidad: it.cantidad, precio_unitario: precio, descuento });
      continue;
    }
    const p = assertOwned('productos', it.producto_id, fincaId, 'producto_id');
    if (!p.activo) throw unprocessable(`El producto "${p.nombre}" está inactivo`);
    const precio = it.precio_unitario ?? p.precio_venta;
    if (precio == null) throw badRequest(`Indica el precio unitario de "${p.nombre}" (no tiene precio de venta definido)`);
    if (p.categoria !== 'productos_cosechados') {
      lines.push({ producto_id: p.id, descripcion: p.nombre, cantidad: it.cantidad, precio_unitario: precio, descuento });
      continue;
    }
    if (it.lote_cosecha_id) {                      // lote elegido explícitamente
      const lc = db.prepare(`SELECT lc.*, c.comercializable, c.lote_id, c.plantacion_id, c.fecha FROM lotes_cosecha lc JOIN cosechas c ON c.id=lc.cosecha_id WHERE lc.id=? AND lc.finca_id=?`).get(it.lote_cosecha_id, fincaId);
      if (!lc) throw badRequest('Lote de cosecha inexistente en esta finca');
      if (lc.producto_id !== p.id) throw unprocessable(`El lote ${lc.codigo} no corresponde al producto "${p.nombre}"`);
      if (!lc.comercializable) throw unprocessable(`El lote ${lc.codigo} no está marcado como comercializable`);
      exigirVendible(lc);
      reservado.set(lc.id, (reservado.get(lc.id) ?? 0) + it.cantidad);
      lines.push({ producto_id: p.id, lote_cosecha_id: lc.id, descripcion: `${p.nombre} (${lc.codigo})`, cantidad: it.cantidad, precio_unitario: precio, descuento });
      continue;
    }
    let restante = it.cantidad; const partes = [];                    // FIFO automático
    for (const lc of lotesVendibles(fincaId, p.id)) {
      if (restante <= 1e-9) break;
      const disp = round3(lc.disponible - (reservado.get(lc.id) ?? 0));
      if (disp <= 0) continue;
      exigirVendible(lc);
      const tomar = round3(Math.min(disp, restante));
      reservado.set(lc.id, (reservado.get(lc.id) ?? 0) + tomar);
      partes.push({ lc, cantidad: tomar }); restante = round3(restante - tomar);
    }
    if (restante > 1e-9) {
      const total = round3(it.cantidad - restante);
      throw unprocessable(`Cantidad insuficiente de "${p.nombre}" comercializable: disponible ${total} ${p.unidad}, solicitado ${it.cantidad}`);
    }
    let descAsignado = 0;
    partes.forEach((pt, i) => {
      const d = i === partes.length - 1 ? round2(descuento - descAsignado) : round2(descuento * pt.cantidad / it.cantidad);
      descAsignado = round2(descAsignado + d);
      lines.push({ producto_id: p.id, lote_cosecha_id: pt.lc.id, descripcion: `${p.nombre} (${pt.lc.codigo})`, cantidad: pt.cantidad, precio_unitario: precio, descuento: d });
    });
  }
  return lines;
}

function registrarPagoInterno({ fincaId, venta, cuenta, monto, metodo, fecha, referencia, usuarioId }) {
  const m = round2(monto);
  if (m <= 0) throw badRequest('El monto debe ser mayor que cero');
  if (m > cuenta.saldo + 0.001) throw unprocessable(`El pago (${m}) excede el saldo pendiente (${cuenta.saldo})`);
  db.prepare('INSERT INTO pagos_venta (finca_id, venta_id, cuenta_id, fecha, monto, metodo, referencia, usuario_id) VALUES (?,?,?,?,?,?,?,?)').run(fincaId, venta.id, cuenta.id, fecha || today(), m, metodo || venta.metodo_pago, referencia ?? null, usuarioId ?? null);
  const saldo = Math.max(0, round2(cuenta.saldo - m));
  db.prepare('UPDATE cuentas_por_cobrar SET saldo = ?, estado = ? WHERE id = ?').run(saldo, saldo === 0 ? 'pagada' : 'parcial', cuenta.id);
  return saldo;
}

/** Confirma una venta: descuenta inventario/vivero, crea la cuenta por cobrar y registra el pago inicial. Todo en una transacción. */
export function confirmarVenta(ventaId, req, { montoPagado } = {}) {
  return tx(() => {
    const fincaId = req.user.fincaId;
    const v = db.prepare('SELECT * FROM ventas WHERE id=? AND finca_id=?').get(ventaId, fincaId);
    if (!v) throw notFound('Venta no encontrada');
    if (v.estado !== 'borrador') throw unprocessable(`La venta ya está ${v.estado}`);
    const det = db.prepare('SELECT * FROM detalle_venta WHERE venta_id=?').all(v.id);
    for (const d of det) {
      if (d.siembra_id) {
        const st = estadoSiembra(d.siembra_id);
        if (st.disponibles < d.cantidad) throw unprocessable(`Plantines insuficientes: disponibles ${st.disponibles}, solicitado ${d.cantidad}`);
        if (!Number.isInteger(d.cantidad)) throw unprocessable('La cantidad de plantines debe ser un número entero');
        db.prepare("INSERT INTO movimientos_vivero (finca_id, siembra_id, tipo, cantidad, fecha, venta_id, observaciones) VALUES (?,?,'venta',?,?,?,?)").run(fincaId, d.siembra_id, d.cantidad, v.fecha, v.id, `Venta ${v.numero}`);
      } else {
        moverStock({ fincaId, productoId: d.producto_id, tipo: 'salida', motivo: 'venta', cantidad: d.cantidad, fecha: v.fecha, loteCosechaId: d.lote_cosecha_id,
          referenciaTipo: 'venta', referenciaId: v.id, claveIdempotencia: `venta:${v.id}:${d.id}`, usuarioId: req.user.id, observaciones: `Venta ${v.numero}` });
      }
    }
    db.prepare("UPDATE ventas SET estado='confirmada' WHERE id=?").run(v.id);
    const c = db.prepare('INSERT INTO cuentas_por_cobrar (finca_id, venta_id, cliente_id, monto_total, saldo, fecha_vencimiento, estado) VALUES (?,?,?,?,?,?,?)').run(fincaId, v.id, v.cliente_id, v.total, v.total, v.fecha_vencimiento, 'pendiente');
    let cuenta = db.prepare('SELECT * FROM cuentas_por_cobrar WHERE id=?').get(c.lastInsertRowid);
    const inicial = montoPagado ?? (v.metodo_pago === 'credito' ? 0 : v.total);
    if (inicial > v.total + 0.001) throw unprocessable('El monto pagado no puede exceder el total de la venta');
    if (inicial > 0) registrarPagoInterno({ fincaId, venta: v, cuenta, monto: inicial, metodo: v.metodo_pago === 'credito' ? 'efectivo' : v.metodo_pago, fecha: v.fecha, usuarioId: req.user.id });
    if (v.total === 0) db.prepare("UPDATE cuentas_por_cobrar SET estado='pagada' WHERE id=?").run(cuenta.id);
    if (v.pedido_id) db.prepare("UPDATE pedidos SET estado='convertido', venta_id=? WHERE id=? AND finca_id=?").run(v.id, v.pedido_id, fincaId);
    audit(req, { accion: 'confirmar_venta', entidad: 'ventas', id: v.id, detalle: { numero: v.numero, total: v.total } });
    return v.id;
  });
}

export function crearVenta(body, req) {
  return tx(() => {
    const fincaId = req.user.fincaId;
    assertOwned('clientes', body.cliente_id, fincaId, 'cliente_id');
    if (body.pedido_id) assertOwned('pedidos', body.pedido_id, fincaId, 'pedido_id');
    const lines = expandirItems(body.items, fincaId);
    const bruto = round2(lines.reduce((s, l) => s + l.cantidad * l.precio_unitario, 0));
    const descuento = round2(lines.reduce((s, l) => s + l.descuento, 0));
    for (const l of lines) { l.subtotal = round2(l.cantidad * l.precio_unitario - l.descuento); if (l.subtotal < 0) throw unprocessable(`El descuento excede el importe de "${l.descripcion}"`); }
    const total = round2(lines.reduce((s, l) => s + l.subtotal, 0));
    const metodo = body.metodo_pago || 'efectivo';
    const info = db.prepare(`INSERT INTO ventas (finca_id, numero, cliente_id, pedido_id, fecha, subtotal, descuento, total, metodo_pago, estado, fecha_vencimiento, observaciones, usuario_id)
      VALUES (?,?,?,?,?,?,?,?,?,'borrador',?,?,?)`).run(fincaId, nextNumero(fincaId), body.cliente_id, body.pedido_id ?? null, body.fecha || today(), bruto, descuento, total, metodo, body.fecha_vencimiento ?? null, body.observaciones ?? null, req.user.id);
    const ins = db.prepare('INSERT INTO detalle_venta (venta_id, producto_id, lote_cosecha_id, siembra_id, descripcion, cantidad, precio_unitario, descuento, subtotal) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const l of lines) ins.run(info.lastInsertRowid, l.producto_id ?? null, l.lote_cosecha_id ?? null, l.siembra_id ?? null, l.descripcion, l.cantidad, l.precio_unitario, l.descuento, l.subtotal);
    audit(req, { accion: 'crear_venta', entidad: 'ventas', id: info.lastInsertRowid, detalle: { total, items: lines.length } });
    if (body.confirmar !== false) confirmarVenta(info.lastInsertRowid, req, { montoPagado: body.monto_pagado ?? undefined });
    return info.lastInsertRowid;
  });
}

export function anularVenta(ventaId, req, motivo) {
  return tx(() => {
    const fincaId = req.user.fincaId;
    const v = db.prepare('SELECT * FROM ventas WHERE id=? AND finca_id=?').get(ventaId, fincaId);
    if (!v) throw notFound('Venta no encontrada');
    if (v.estado === 'anulada') throw unprocessable('La venta ya está anulada');
    if (v.estado === 'confirmada') {
      const det = db.prepare('SELECT * FROM detalle_venta WHERE venta_id=?').all(v.id);
      for (const d of det) {
        if (d.siembra_id) db.prepare("DELETE FROM movimientos_vivero WHERE venta_id=? AND siembra_id=? AND tipo='venta'").run(v.id, d.siembra_id);
        else moverStock({ fincaId, productoId: d.producto_id, tipo: 'entrada', motivo: 'anulacion', cantidad: d.cantidad, fecha: today(), loteCosechaId: d.lote_cosecha_id, referenciaTipo: 'venta', referenciaId: v.id, claveIdempotencia: `venta-anul:${v.id}:${d.id}`, usuarioId: req.user.id, observaciones: `Anulación de venta ${v.numero}` });
      }
      db.prepare("UPDATE cuentas_por_cobrar SET estado='anulada', saldo=0 WHERE venta_id=?").run(v.id);
    }
    db.prepare("UPDATE ventas SET estado='anulada', observaciones=TRIM(COALESCE(observaciones,'') || ' [Anulada: ' || ? || ']') WHERE id=?").run(motivo || 'sin motivo', v.id);
    if (v.pedido_id) db.prepare("UPDATE pedidos SET estado='confirmado', venta_id=NULL WHERE id=?").run(v.pedido_id);
    const cobrado = db.prepare('SELECT COALESCE(SUM(monto),0) s FROM pagos_venta WHERE venta_id=?').get(v.id).s;
    audit(req, { accion: 'anular_venta', entidad: 'ventas', id: v.id, detalle: { numero: v.numero, motivo, cobrado } });
    return { cobrado_a_devolver: round2(cobrado) };
  });
}

export function registrarPago(ventaId, body, req) {
  return tx(() => {
    const fincaId = req.user.fincaId;
    const v = db.prepare('SELECT * FROM ventas WHERE id=? AND finca_id=?').get(ventaId, fincaId);
    if (!v) throw notFound('Venta no encontrada');
    if (v.estado !== 'confirmada') throw unprocessable('Solo se pueden registrar pagos en ventas confirmadas');
    const cuenta = db.prepare('SELECT * FROM cuentas_por_cobrar WHERE venta_id=?').get(v.id);
    if (cuenta.saldo <= 0) throw unprocessable('La venta ya está pagada');
    const saldo = registrarPagoInterno({ fincaId, venta: v, cuenta, monto: body.monto, metodo: body.metodo, fecha: body.fecha, referencia: body.referencia, usuarioId: req.user.id });
    audit(req, { accion: 'registrar_cobro', entidad: 'ventas', id: v.id, detalle: { monto: body.monto, saldo } });
    return { saldo, estado: saldo === 0 ? 'pagada' : 'parcial' };
  });
}
