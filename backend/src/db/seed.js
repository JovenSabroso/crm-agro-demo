/**
 * DATOS DE DEMOSTRACIÓN (100 % ficticios). Separado del esquema real: se ejecuta solo con `npm run seed`.
 * Los datos se generan usando los mismos servicios de negocio que la API (inventario, cosechas, ventas, pagos),
 * por lo que respetan todas las reglas (carencias, stock, trazabilidad). Fechas relativas a "hoy".
 *   npm run seed           → carga la finca demo si la base está vacía
 *   npm run reset          → borra la base de datos local y la vuelve a cargar
 */
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { config } from '../config/env.js';

const reset = process.argv.includes('--reset');
if (reset && config.dbPath !== ':memory:') for (const ext of ['', '-wal', '-shm']) fs.rmSync(config.dbPath + ext, { force: true });

const { db } = await import('./index.js');
const { addDays, today } = await import('../core/utils.js');
const { moverStock } = await import('../modules/inventario.service.js');
const { registrarCosecha, ingresarCosechaInventario } = await import('../modules/campo.js');
const { crearVenta, registrarPago } = await import('../modules/ventas.service.js');
const { calcularPago } = await import('../modules/trabajadores.js');

if (db.prepare('SELECT COUNT(*) c FROM fincas').get().c > 0) { console.log('La base de datos ya contiene datos. Usa `npm run reset` para recargar la demostración.'); process.exit(0); }

export const DEMO_PASSWORD = 'Demo1234';
const D = (n) => addDays(today(), n);
const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);

db.transaction(() => {
  // ---------- Finca y usuarios ----------
  const f = db.prepare("INSERT INTO fincas (nombre, ubicacion, latitud, longitud, superficie_ha, moneda, telefono, descripcion) VALUES (?,?,?,?,?,?,?,?)")
    .run('Finca El Mirador (DEMO)', 'Valle de Luribay, La Paz', -17.0647, -67.6458, 3.5, 'BOB', '70000000', 'DATOS DE DEMOSTRACIÓN FICTICIOS generados por npm run seed. No corresponden a ninguna finca real.').lastInsertRowid;
  db.prepare('INSERT INTO modulos_activos (finca_id, modulo_id, activo) SELECT ?, id, 1 FROM modulos').run(f);
  const rol = (c) => db.prepare('SELECT id FROM roles WHERE codigo=?').get(c).id;
  const user = (nombre, email, r) => db.prepare('INSERT INTO usuarios (finca_id, rol_id, nombre, email, password_hash) VALUES (?,?,?,?,?)').run(f, rol(r), nombre, email, hash).lastInsertRowid;
  const uProp = user('Carmen Quispe (demo)', 'propietario@crmagro.test', 'propietario');
  user('Luis Mamani (demo)', 'encargado@crmagro.test', 'encargado');
  user('Rosa Choque (demo)', 'trabajador@crmagro.test', 'trabajador');
  const req = { user: { id: uProp, fincaId: f }, ip: 'seed' };
  const ins = (sql, ...a) => db.prepare(sql).run(...a).lastInsertRowid;

  // ---------- Lotes, cultivos, campaña, plantaciones ----------
  const lote = (codigo, nombre, ha, lat, lng) => ins('INSERT INTO lotes (finca_id, codigo, nombre, superficie_ha, tipo_suelo, latitud, longitud) VALUES (?,?,?,?,?,?,?)', f, codigo, nombre, ha, 'franco', lat, lng);
  const L1 = lote('L1', 'Lote Tomates', 0.8, -17.0640, -67.6465), L2 = lote('L2', 'Lote Hortalizas', 0.6, -17.0650, -67.6452), L3 = lote('L3', 'Lote Fresas', 0.5, -17.0655, -67.6470), L4 = lote('L4', 'Huerto Duraznos', 1.2, -17.0635, -67.6440), L5 = lote('L5', 'Lote Zanahoria', 0.4, -17.0660, -67.6448);
  const cult = (n, v, t, ciclo, u = 'kg') => ins('INSERT INTO cultivos (finca_id, nombre, variedad, tipo, ciclo_dias, unidad_cosecha) VALUES (?,?,?,?,?,?)', f, n, v, t, ciclo, u);
  const cTomate = cult('Tomate', 'Cherry', 'hortaliza', 100), cLechuga = cult('Lechuga', 'Crespa', 'hortaliza', 60), cFresa = cult('Fresa', null, 'fruta', 150), cDurazno = cult('Durazno', null, 'fruta', 365), cZanahoria = cult('Zanahoria', null, 'tuberculo', 110);
  const camp = ins("INSERT INTO campanas (finca_id, nombre, fecha_inicio, estado) VALUES (?,?,?,'activa')", f, 'Campaña 2026-2027', D(-160));
  const plant = (lt, cu, sie, est, estado = 'activo') => ins('INSERT INTO plantaciones (finca_id, lote_id, cultivo_id, campana_id, fecha_siembra, fecha_cosecha_estimada, estado) VALUES (?,?,?,?,?,?,?)', f, lt, cu, camp, sie, est, estado);
  const P5old = plant(L5, cZanahoria, D(-150), D(-40), 'cosechado');
  const P1 = plant(L1, cTomate, D(-75), D(15)), P2 = plant(L2, cLechuga, D(-50), D(5)), P3 = plant(L3, cFresa, D(-100), D(20)), P4 = plant(L4, cDurazno, D(-300), D(40));
  const P5 = plant(L5, cZanahoria, D(-30), D(80));

  // ---------- Trabajadores ----------
  const trab = (n, doc, cargo, tarifa) => ins('INSERT INTO trabajadores (finca_id, nombre, documento, telefono, cargo, tarifa_jornal, fecha_ingreso, consentimiento_datos) VALUES (?,?,?,?,?,?,?,1)', f, n, doc, '7' + Math.floor(1e6 + Math.random() * 8e6), cargo, tarifa, D(-400));
  const T = [trab('Juan Condori (demo)', '1000001', 'Regador', 100), trab('María Apaza (demo)', '1000002', 'Cosechadora', 110), trab('Pedro Ticona (demo)', '1000003', 'Tractorista', 130), trab('Ana Flores (demo)', '1000004', 'Viverista', 105), trab('Mario Huanca (demo)', '1000005', 'Peón', 95)];

  // ---------- Proveedores y productos ----------
  const prov = (n) => ins('INSERT INTO proveedores (finca_id, nombre, contacto, telefono) VALUES (?,?,?,?)', f, n, 'Contacto demo', '2200000');
  const pv1 = prov('Agroinsumos Altiplano (demo)'), pv2 = prov('Semillas del Valle (demo)'), pv3 = prov('Ferretería Rural (demo)');
  const prod = (cat, n, u, min, precio = null, carencia = null, etiqueta = null, pv = null) => ins('INSERT INTO productos (finca_id, categoria, nombre, unidad, stock_minimo, precio_venta, periodo_carencia_dias, etiqueta_info, proveedor_id) VALUES (?,?,?,?,?,?,?,?,?)', f, cat, n, u, min, precio, carencia, etiqueta, pv);
  const pSemT = prod('semillas', 'Semilla de tomate cherry', 'sobre', 5, null, null, null, pv2), pSemL = prod('semillas', 'Semilla de lechuga crespa', 'sobre', 5, null, null, null, pv2);
  const pNPK = prod('fertilizantes', 'Fertilizante NPK 15-15-15', 'kg', 50, null, null, null, pv1), pHumus = prod('fertilizantes', 'Abono orgánico (humus)', 'kg', 100, null, null, null, pv1);
  const pFung = prod('agroquimicos', 'Fungicida DEMO-F1', 'L', 2, null, 7, 'Texto FICTICIO de demostración: seguir siempre la etiqueta del fabricante.', pv1), pInsec = prod('agroquimicos', 'Insecticida DEMO-I1', 'L', 2, null, 3, 'Texto FICTICIO de demostración: seguir siempre la etiqueta del fabricante.', pv1);
  const pTijera = prod('herramientas', 'Tijera de poda', 'u', 2, null, null, null, pv3), pCinta = prod('materiales', 'Cinta de riego por goteo', 'm', 100, null, null, null, pv3), pBolsa = prod('materiales', 'Bolsas para plantines', 'u', 500, null, null, null, pv3);
  const pPlantinDur = prod('plantines', 'Plantín de durazno injertado', 'u', 10, 18, null, null, null);
  const compra = (p, c, costo, dias, pv) => moverStock({ fincaId: f, productoId: p, tipo: 'entrada', motivo: 'compra', cantidad: c, costoUnitario: costo, fecha: D(dias), proveedorId: pv, usuarioId: uProp, observaciones: 'Compra (demo)' });
  compra(pSemT, 30, 14, -80, pv2); compra(pSemL, 25, 9, -60, pv2); compra(pNPK, 200, 8.5, -78, pv1); compra(pHumus, 400, 2.2, -78, pv1);
  compra(pFung, 10, 95, -70, pv1); compra(pInsec, 5, 80, -70, pv1); compra(pTijera, 3, 45, -200, pv3); compra(pCinta, 400, 1.8, -90, pv3); compra(pBolsa, 300, 0.15, -40, pv3); compra(pPlantinDur, 40, 7, -20, null);

  // ---------- Campo: labores, riegos, aplicaciones ----------
  const labor = (lt, pl, tipo, prog, estado, resp) => ins('INSERT INTO labores (finca_id, lote_id, plantacion_id, tipo, fecha_programada, fecha_realizada, estado, responsable_id, created_by) VALUES (?,?,?,?,?,?,?,?,?)', f, lt, pl, tipo, prog, estado === 'completada' ? prog : null, estado, resp, uProp);
  const lab1 = labor(L1, P1, 'Preparación de suelo', D(-80), 'completada', T[2]); labor(L1, P1, 'Siembra', D(-75), 'completada', T[4]); labor(L1, P1, 'Deshierbe', D(-45), 'completada', T[4]); labor(L1, P1, 'Tutorado', D(-30), 'completada', T[4]);
  labor(L2, P2, 'Siembra', D(-50), 'completada', T[4]); labor(L3, P3, 'Poda de estolones', D(-20), 'completada', T[1]); labor(L5, P5, 'Raleo', D(-10), 'completada', T[4]);
  labor(L1, P1, 'Fertilización', D(-2), 'pendiente', T[0]); labor(L2, P2, 'Deshierbe', D(3), 'pendiente', T[4]); labor(L4, P4, 'Poda de formación', D(7), 'pendiente', T[2]); labor(L3, P3, 'Control de maleza', D(10), 'pendiente', T[4]);
  ins("INSERT INTO tareas (finca_id, trabajador_id, labor_id, titulo, fecha, estado) VALUES (?,?,?,?,?,'pendiente')", f, T[0], lab1, 'Fertilizar lote de tomates', D(0));
  ins("INSERT INTO tareas (finca_id, trabajador_id, titulo, fecha, estado) VALUES (?,?,?,?,'pendiente')", f, T[4], 'Deshierbe de lote de hortalizas', D(3));
  for (let i = 1; i <= 24; i += 3) { ins("INSERT INTO riegos (finca_id, lote_id, plantacion_id, fecha, metodo, duracion_min, volumen_litros, responsable_id) VALUES (?,?,?,?,'goteo',?,?,?)", f, L1, P1, D(-i), 90, 1800, T[0]); if (i < 12) ins("INSERT INTO riegos (finca_id, lote_id, plantacion_id, fecha, metodo, duracion_min, volumen_litros, responsable_id) VALUES (?,?,?,?,'aspersión',?,?,?)", f, L2, P2, D(-i), 60, 1200, T[0]); }
  ins("INSERT INTO riegos (finca_id, lote_id, plantacion_id, fecha, metodo, duracion_min, volumen_litros, responsable_id) VALUES (?,?,?,?,'goteo',?,?,?)", f, L3, P3, D(-9), 45, 700, T[0]);

  const apl = (lt, pl, prodId, nombre, motivo, fecha, cant, carencia, estado = 'aplicada') => {
    const id = ins('INSERT INTO aplicaciones_fito (finca_id, lote_id, plantacion_id, producto_id, producto_nombre, motivo, estado, fecha_programada, fecha_aplicacion, dosis_registrada, cantidad_usada, periodo_carencia_dias, fecha_fin_carencia, responsable_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      f, lt, pl, prodId, nombre, motivo, estado, fecha, estado === 'aplicada' ? fecha : null, estado === 'aplicada' ? 'Según etiqueta del producto (dato demo)' : null, cant, carencia, estado === 'aplicada' ? addDays(fecha, carencia) : null, T[0]);
    if (estado === 'aplicada' && prodId && cant > 0) moverStock({ fincaId: f, productoId: prodId, tipo: 'salida', motivo: 'consumo', cantidad: cant, fecha, loteId: lt, referenciaTipo: 'aplicacion', referenciaId: id, claveIdempotencia: `apl:${id}`, usuarioId: uProp });
    return id;
  };
  apl(L1, P1, pFung, 'Fungicida DEMO-F1', 'Prevención de tizón (demo)', D(-40), 1.5, 7);
  apl(L3, P3, pInsec, 'Insecticida DEMO-I1', 'Control de pulgón (demo)', D(-15), 1.0, 3);
  apl(L5, P5, pInsec, 'Insecticida DEMO-I1', 'Control de plaga (demo)', D(-8), 1.0, 3);
  apl(L2, P2, pFung, 'Fungicida DEMO-F1', 'Hongos en hoja (demo)', D(-2), 1.0, 7);       // carencia vigente: la cosecha de hoy no puede comercializarse
  apl(L4, P4, pInsec, 'Insecticida DEMO-I1', 'Control preventivo (demo)', D(-1), 0.5, 3);
  apl(L1, P1, pFung, 'Fungicida DEMO-F1', 'Segunda aplicación preventiva (demo)', D(-1), 0, 7, 'pendiente'); // pendiente atrasada
  db.prepare("UPDATE aplicaciones_fito SET fecha_programada=? WHERE estado='pendiente'").run(D(-1));
  moverStock({ fincaId: f, productoId: pNPK, tipo: 'salida', motivo: 'consumo', cantidad: 60, fecha: D(-70), loteId: L1, usuarioId: uProp, observaciones: 'Abonado de fondo (demo)' });
  moverStock({ fincaId: f, productoId: pHumus, tipo: 'salida', motivo: 'consumo', cantidad: 250, fecha: D(-72), loteId: L1, usuarioId: uProp });
  moverStock({ fincaId: f, productoId: pNPK, tipo: 'salida', motivo: 'consumo', cantidad: 40, fecha: D(-30), loteId: L3, usuarioId: uProp });
  moverStock({ fincaId: f, productoId: pSemT, tipo: 'salida', motivo: 'consumo', cantidad: 8, fecha: D(-75), loteId: L1, usuarioId: uProp });

  // ---------- Cosechas (con lote de cosecha/QR) e ingreso a inventario ----------
  const cosecha = (lt, pl, fecha, cant, comerc = true, inv = true, calidad = 'Primera') => {
    const c = registrarCosecha({ ...req, body: { lote_id: lt, plantacion_id: pl, fecha, cantidad: cant, calidad, comercializable: comerc ? 1 : 0, ingresar_inventario: inv ? 1 : 0, responsable_id: T[1] } });
    return c;
  };
  cosecha(L5, P5old, D(-45), 300, true, true); cosecha(L5, P5old, D(-42), 180, true, true);
  cosecha(L1, P1, D(-22), 120, true, true); cosecha(L1, P1, D(-15), 150, true, true); cosecha(L1, P1, D(-8), 135, true, true); cosecha(L1, P1, D(-3), 110, true, true);
  cosecha(L3, P3, D(-12), 40, true, true); cosecha(L3, P3, D(-5), 55, true, true);
  cosecha(L2, P2, D(0), 22, false, false, 'En carencia');           // se retiene: carencia vigente
  // Precios de venta de productos cosechados
  db.prepare("UPDATE productos SET precio_venta = CASE nombre WHEN 'Tomate Cherry' THEN 12 WHEN 'Fresa' THEN 25 WHEN 'Zanahoria' THEN 6 ELSE precio_venta END WHERE finca_id=? AND categoria='productos_cosechados'").run(f);
  const pTom = db.prepare("SELECT id FROM productos WHERE nombre='Tomate Cherry'").get().id, pFre = db.prepare("SELECT id FROM productos WHERE nombre='Fresa'").get().id, pZan = db.prepare("SELECT id FROM productos WHERE nombre='Zanahoria'").get().id;

  // ---------- Clientes, ventas, cobros ----------
  const cli = (n, tel) => ins('INSERT INTO clientes (finca_id, nombre, documento, telefono, direccion, consentimiento_contacto, notas) VALUES (?,?,?,?,?,1,?)', f, n, null, tel, 'El Alto (demo)', 'Cliente FICTICIO de demostración');
  const C = [cli('Mercado Rodríguez - puesto 12 (demo)', '70011111'), cli('Restaurante Sabor Andino (demo)', '70022222'), cli('Supermercado Verde (demo)', '70033333'), cli('Familia Gutiérrez (demo)', '70044444')];
  const vend = (cl, dias, items, metodo = 'efectivo', extra = {}) => crearVenta({ cliente_id: cl, fecha: D(dias), metodo_pago: metodo, items, confirmar: true, ...extra }, req);
  vend(C[0], -40, [{ producto_id: pZan, cantidad: 200 }]); vend(C[1], -35, [{ producto_id: pZan, cantidad: 150, descuento: 30 }], 'transferencia');
  vend(C[0], -18, [{ producto_id: pTom, cantidad: 80 }]); vend(C[2], -12, [{ producto_id: pTom, cantidad: 150 }], 'credito', { fecha_vencimiento: D(-2), monto_pagado: 600 });
  vend(C[1], -9, [{ producto_id: pFre, cantidad: 25 }, { producto_id: pTom, cantidad: 40 }], 'qr'); vend(C[3], -4, [{ producto_id: pTom, cantidad: 30 }]);
  const vCred = vend(C[2], -3, [{ producto_id: pFre, cantidad: 30 }, { producto_id: pTom, cantidad: 100 }], 'credito', { fecha_vencimiento: D(12) });
  registrarPago(vCred, { monto: 300, metodo: 'transferencia', fecha: D(-1) }, req);
  const pedido = ins("INSERT INTO pedidos (finca_id, cliente_id, fecha, fecha_entrega, observaciones) VALUES (?,?,?,?,?)", f, C[1], D(0), D(2), 'Pedido de demostración');
  ins('INSERT INTO pedido_detalles (pedido_id, producto_id, cantidad, precio_unitario) VALUES (?,?,?,?)', pedido, pTom, 40, 12);

  // ---------- Vivero ----------
  const viv = ins("INSERT INTO viveros (finca_id, nombre, ubicacion) VALUES (?,?,?)", f, 'Vivero Principal', 'Sector norte');
  const esp = (n, v, tipo, dias, precio) => ins('INSERT INTO especies (finca_id, nombre, variedad, tipo, dias_germinacion, precio_plantin) VALUES (?,?,?,?,?,?)', f, n, v, tipo, dias, precio);
  const eT = esp('Tomate', 'Cherry', 'hortaliza', 8, 1.5), eL = esp('Lechuga', 'Crespa', 'hortaliza', 5, 0.8), eD = esp('Durazno', 'Blanquillo', 'frutal', 25, 18);
  const sie = (cod, e, fecha, cant) => ins('INSERT INTO siembras_vivero (finca_id, vivero_id, especie_id, codigo, fecha_siembra, cantidad_sembrada) VALUES (?,?,?,?,?,?)', f, viv, e, cod, fecha, cant);
  const mv = (s, tipo, cant, dias, extra = null) => ins('INSERT INTO movimientos_vivero (finca_id, siembra_id, tipo, cantidad, fecha, altura_cm) VALUES (?,?,?,?,?,?)', f, s, tipo, cant, D(dias), extra);
  const s1 = sie('SV-0001', eT, D(-35), 600), s2 = sie('SV-0002', eL, D(-20), 800), s3 = sie('SV-0003', eD, D(-70), 120);
  mv(s1, 'germinacion', 540, -26); mv(s1, 'crecimiento', 0, -10, 14); mv(s1, 'perdida', 25, -12); mv(s2, 'germinacion', 720, -14); mv(s2, 'perdida', 20, -7); mv(s3, 'germinacion', 95, -40); mv(s3, 'crecimiento', 0, -5, 38);
  ins("INSERT INTO gastos (finca_id, fecha, categoria, descripcion, monto, siembra_id) VALUES (?,?,'vivero',?,?,?)", f, D(-34), 'Sustrato y bandejas (demo)', 180, s1);
  ins("INSERT INTO gastos (finca_id, fecha, categoria, descripcion, monto, siembra_id) VALUES (?,?,'vivero',?,?,?)", f, D(-69), 'Sustrato, injertos y riego (demo)', 420, s3);
  moverStock({ fincaId: f, productoId: pSemT, tipo: 'salida', motivo: 'consumo', cantidad: 4, fecha: D(-35), referenciaTipo: 'siembra', referenciaId: s1, usuarioId: uProp });
  crearVenta({ cliente_id: C[0], fecha: D(-6), metodo_pago: 'efectivo', items: [{ siembra_id: s1, cantidad: 250 }], confirmar: true }, req);
  crearVenta({ cliente_id: C[3], fecha: D(-2), metodo_pago: 'efectivo', items: [{ siembra_id: s3, cantidad: 20 }], confirmar: true }, req);

  // ---------- Asistencia, jornales, anticipos, pagos ----------
  const est = ['presente', 'presente', 'presente', 'retraso', 'ausente'];
  for (let d = -20; d <= 0; d++) { const dow = new Date(D(d) + 'T00:00:00Z').getUTCDay(); if (dow === 0) continue;
    T.forEach((t, i) => { if (d === 0 && i === 4) return; const e = (d + i) % 9 === 0 ? 'ausente' : (d + i) % 7 === 0 ? 'retraso' : est[0];
      ins('INSERT INTO asistencias (finca_id, trabajador_id, fecha, estado, hora_entrada, justificacion) VALUES (?,?,?,?,?,?)', f, t, D(d), e, e === 'ausente' ? null : (e === 'retraso' ? '08:20' : '07:00'), e === 'ausente' ? 'Enfermedad (demo)' : null); }); }
  const tarifa = db.prepare('SELECT id, tarifa_jornal FROM trabajadores').all();
  for (let d = -40; d <= -1; d++) { const dow = new Date(D(d) + 'T00:00:00Z').getUTCDay(); if (dow === 0) continue;
    T.slice(0, 4).forEach((t, i) => { if ((d + i) % 6 === 0) return; const tf = tarifa.find(x => x.id === t).tarifa_jornal; const lt = [L1, L2, L3, L4][(d + i + 40) % 4];
      ins("INSERT INTO jornales (finca_id, trabajador_id, fecha, jornadas, tarifa, monto, lote_id, tipo) VALUES (?,?,?,?,?,?,?,?)", f, t, D(d), 1, tf, tf, lt, i === 1 ? 'cosecha' : 'campo'); }); }
  ins('INSERT INTO anticipos (finca_id, trabajador_id, fecha, monto, motivo) VALUES (?,?,?,?,?)', f, T[0], D(-20), 150, 'Anticipo (demo)');
  ins('INSERT INTO anticipos (finca_id, trabajador_id, fecha, monto, motivo) VALUES (?,?,?,?,?)', f, T[2], D(-5), 200, 'Anticipo (demo)');
  for (const t of T.slice(0, 3)) {                        // pagos de las últimas semanas anteriores
    const c = calcularPago(f, t, D(-40), D(-15), true);
    if (c.jornales.length) { const pid = ins('INSERT INTO pagos (finca_id, trabajador_id, fecha, periodo_desde, periodo_hasta, bruto, anticipos_descontados, neto, metodo, usuario_id) VALUES (?,?,?,?,?,?,?,?,?,?)', f, t, D(-14), D(-40), D(-15), c.bruto, c.anticipos_descontados, c.neto, 'efectivo', uProp);
      c.jornales.forEach(j => ins('UPDATE jornales SET pago_id=? WHERE id=?', pid, j.id)); c.anticipos_aplicados.forEach(a => ins('UPDATE anticipos SET pago_id=? WHERE id=?', pid, a.id)); }
  }

  // ---------- Gastos e ingresos manuales ----------
  ins("INSERT INTO gastos (finca_id, fecha, categoria, descripcion, monto, lote_id) VALUES (?,?,'mantenimiento',?,?,?)", f, D(-60), 'Reparación de sistema de riego (demo)', 320, L1);
  ins("INSERT INTO gastos (finca_id, fecha, categoria, descripcion, monto) VALUES (?,?,'transporte',?,?)", f, D(-10), 'Flete a mercado (demo)', 150);
  ins("INSERT INTO gastos (finca_id, fecha, categoria, descripcion, monto, lote_id) VALUES (?,?,'cosecha',?,?,?)", f, D(-8), 'Cajas y embalaje de cosecha (demo)', 90, L1);
  ins("INSERT INTO ingresos (finca_id, fecha, categoria, descripcion, monto) VALUES (?,?,'otros',?,?)", f, D(-25), 'Venta de abono sobrante (demo)', 200);
})();

console.log('Datos de demostración cargados.\nUsuarios de prueba (contraseña: %s):\n  propietario@crmagro.test\n  encargado@crmagro.test\n  trabajador@crmagro.test', DEMO_PASSWORD);
