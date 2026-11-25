-- CRM-Agro · Migración 001 · esquema base (SQLite)
-- Fechas: TEXT ISO-8601 (YYYY-MM-DD o fecha-hora UTC). Cantidades: REAL. Dinero: REAL redondeado a 2 decimales.

-- ===================== M0 · NÚCLEO =====================
CREATE TABLE fincas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  ubicacion TEXT,
  latitud REAL, longitud REAL,
  superficie_ha REAL CHECK (superficie_ha IS NULL OR superficie_ha >= 0),
  moneda TEXT NOT NULL DEFAULT 'BOB',
  telefono TEXT,
  descripcion TEXT,
  activa INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL
);
CREATE TABLE permisos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  descripcion TEXT
);
CREATE TABLE rol_permisos (
  rol_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permiso_id INTEGER NOT NULL REFERENCES permisos(id) ON DELETE CASCADE,
  PRIMARY KEY (rol_id, permiso_id)
);

CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE RESTRICT,
  rol_id INTEGER NOT NULL REFERENCES roles(id),
  nombre TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  token_version INTEGER NOT NULL DEFAULT 0,
  reset_token_hash TEXT,
  reset_expira TEXT,
  ultimo_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_usuarios_finca ON usuarios(finca_id);

CREATE TABLE modulos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,         -- M0..M7
  nombre TEXT NOT NULL,
  descripcion TEXT,
  obligatorio INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE modulos_activos (
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  modulo_id INTEGER NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
  activo INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (finca_id, modulo_id)
);

CREATE TABLE lotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  superficie_ha REAL CHECK (superficie_ha IS NULL OR superficie_ha >= 0),
  tipo_suelo TEXT,
  latitud REAL, longitud REAL,
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','descanso','inactivo')),
  observaciones TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (finca_id, codigo)
);

CREATE TABLE cultivos (          -- catálogo de cultivos de la finca
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  variedad TEXT,
  tipo TEXT NOT NULL DEFAULT 'hortaliza' CHECK (tipo IN ('hortaliza','fruta','cereal','tuberculo','forraje','otro')),
  ciclo_dias INTEGER CHECK (ciclo_dias IS NULL OR ciclo_dias > 0),
  unidad_cosecha TEXT NOT NULL DEFAULT 'kg',
  UNIQUE (finca_id, nombre, variedad)
);

CREATE TABLE campanas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  fecha_inicio TEXT NOT NULL,
  fecha_fin TEXT,
  estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('planificada','activa','cerrada')),
  observaciones TEXT,
  UNIQUE (finca_id, nombre)
);

-- Cultivo establecido en un lote durante una campaña (asocia lote ↔ cultivo)
CREATE TABLE plantaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  lote_id INTEGER NOT NULL REFERENCES lotes(id) ON DELETE RESTRICT,
  cultivo_id INTEGER NOT NULL REFERENCES cultivos(id) ON DELETE RESTRICT,
  campana_id INTEGER REFERENCES campanas(id) ON DELETE SET NULL,
  fecha_siembra TEXT NOT NULL,
  fecha_cosecha_estimada TEXT,
  superficie_ha REAL CHECK (superficie_ha IS NULL OR superficie_ha >= 0),
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','cosechado','cerrado')),
  observaciones TEXT
);
CREATE INDEX idx_plant_lote ON plantaciones(lote_id, estado);
CREATE INDEX idx_plant_finca ON plantaciones(finca_id, estado);

-- ===================== M3 · TRABAJADORES (antes de M1 por FK) =====================
CREATE TABLE trabajadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  nombre TEXT NOT NULL,
  documento TEXT,
  telefono TEXT,
  cargo TEXT,
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','inactivo','suspendido')),
  tarifa_jornal REAL NOT NULL DEFAULT 0 CHECK (tarifa_jornal >= 0),
  fecha_ingreso TEXT,
  consentimiento_datos INTEGER NOT NULL DEFAULT 0,
  observaciones TEXT,
  UNIQUE (finca_id, documento)
);

-- ===================== M4 · INVENTARIOS =====================
CREATE TABLE proveedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  contacto TEXT, telefono TEXT, email TEXT, direccion TEXT,
  UNIQUE (finca_id, nombre)
);

CREATE TABLE productos (          -- Insumo + Producto cosechado + Plantín en una sola entidad, diferenciada por categoría
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL CHECK (categoria IN ('semillas','fertilizantes','agroquimicos','herramientas','materiales','productos_cosechados','plantines')),
  nombre TEXT NOT NULL,
  unidad TEXT NOT NULL DEFAULT 'kg',
  stock_actual REAL NOT NULL DEFAULT 0 CHECK (stock_actual >= 0),
  stock_minimo REAL NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  costo_promedio REAL NOT NULL DEFAULT 0 CHECK (costo_promedio >= 0),
  precio_venta REAL CHECK (precio_venta IS NULL OR precio_venta >= 0),
  proveedor_id INTEGER REFERENCES proveedores(id) ON DELETE SET NULL,
  periodo_carencia_dias INTEGER,   -- dato informado por etiqueta (opcional, solo agroquímicos)
  etiqueta_info TEXT,              -- texto transcrito de la etiqueta del producto; el sistema NO sugiere dosis
  activo INTEGER NOT NULL DEFAULT 1,
  UNIQUE (finca_id, categoria, nombre)
);
CREATE INDEX idx_prod_finca_cat ON productos(finca_id, categoria);

-- ===================== M1 · CAMPO =====================
CREATE TABLE labores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  lote_id INTEGER NOT NULL REFERENCES lotes(id) ON DELETE RESTRICT,
  plantacion_id INTEGER REFERENCES plantaciones(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,              -- preparación, siembra, deshierbe, poda, fertilización, etc.
  descripcion TEXT,
  fecha_programada TEXT NOT NULL,
  fecha_realizada TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_curso','completada','cancelada')),
  responsable_id INTEGER REFERENCES trabajadores(id) ON DELETE SET NULL,
  observaciones TEXT,
  created_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_labores_lote ON labores(lote_id, fecha_programada);
CREATE INDEX idx_labores_finca_estado ON labores(finca_id, estado, fecha_programada);

CREATE TABLE tareas (             -- asignación de actividades a trabajadores
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  trabajador_id INTEGER NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
  labor_id INTEGER REFERENCES labores(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  fecha TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_curso','completada','cancelada'))
);
CREATE INDEX idx_tareas_trab ON tareas(trabajador_id, fecha);

CREATE TABLE riegos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  lote_id INTEGER NOT NULL REFERENCES lotes(id) ON DELETE RESTRICT,
  plantacion_id INTEGER REFERENCES plantaciones(id) ON DELETE SET NULL,
  fecha TEXT NOT NULL,
  metodo TEXT NOT NULL DEFAULT 'goteo',
  duracion_min INTEGER CHECK (duracion_min IS NULL OR duracion_min >= 0),
  volumen_litros REAL CHECK (volumen_litros IS NULL OR volumen_litros >= 0),
  responsable_id INTEGER REFERENCES trabajadores(id) ON DELETE SET NULL,
  observaciones TEXT
);
CREATE INDEX idx_riegos_lote ON riegos(lote_id, fecha);

CREATE TABLE aplicaciones_fito (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  lote_id INTEGER NOT NULL REFERENCES lotes(id) ON DELETE RESTRICT,
  plantacion_id INTEGER REFERENCES plantaciones(id) ON DELETE SET NULL,
  producto_id INTEGER REFERENCES productos(id) ON DELETE SET NULL,
  producto_nombre TEXT NOT NULL,
  motivo TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aplicada','cancelada')),
  fecha_programada TEXT,
  fecha_aplicacion TEXT,
  dosis_registrada TEXT,           -- texto libre: lo que indica la etiqueta o el profesional; el sistema no calcula dosis
  cantidad_usada REAL CHECK (cantidad_usada IS NULL OR cantidad_usada >= 0),
  periodo_carencia_dias INTEGER NOT NULL DEFAULT 0 CHECK (periodo_carencia_dias >= 0),
  fecha_fin_carencia TEXT,         -- fecha_aplicacion + periodo_carencia_dias
  responsable_id INTEGER REFERENCES trabajadores(id) ON DELETE SET NULL,
  observaciones TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_apl_lote ON aplicaciones_fito(lote_id, estado);
CREATE INDEX idx_apl_plant ON aplicaciones_fito(plantacion_id, fecha_fin_carencia);

CREATE TABLE cosechas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  lote_id INTEGER NOT NULL REFERENCES lotes(id) ON DELETE RESTRICT,
  plantacion_id INTEGER NOT NULL REFERENCES plantaciones(id) ON DELETE RESTRICT,
  fecha TEXT NOT NULL,
  cantidad REAL NOT NULL CHECK (cantidad > 0),
  unidad TEXT NOT NULL DEFAULT 'kg',
  calidad TEXT,
  comercializable INTEGER NOT NULL DEFAULT 0,
  responsable_id INTEGER REFERENCES trabajadores(id) ON DELETE SET NULL,
  observaciones TEXT,
  created_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_cos_lote ON cosechas(lote_id, fecha);

-- Lote de cosecha: unidad trazable con código único y QR
CREATE TABLE lotes_cosecha (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  cosecha_id INTEGER NOT NULL UNIQUE REFERENCES cosechas(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL UNIQUE,     -- ej. LC-20261125-A1B2C3
  producto_id INTEGER REFERENCES productos(id) ON DELETE SET NULL,  -- se fija al ingresar al inventario
  cantidad_inventariada REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE movimientos_inventario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada','salida','ajuste')),
  motivo TEXT NOT NULL,            -- compra, cosecha, consumo, venta, merma, ajuste, vivero, anulacion
  cantidad REAL NOT NULL CHECK (cantidad > 0),
  delta REAL NOT NULL,             -- variación con signo aplicada al stock
  stock_resultante REAL NOT NULL CHECK (stock_resultante >= 0),
  costo_unitario REAL NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0),
  fecha TEXT NOT NULL,
  proveedor_id INTEGER REFERENCES proveedores(id) ON DELETE SET NULL,
  lote_id INTEGER REFERENCES lotes(id) ON DELETE SET NULL,           -- lote de campo al que se imputa el consumo
  lote_cosecha_id INTEGER REFERENCES lotes_cosecha(id) ON DELETE SET NULL,
  referencia_tipo TEXT, referencia_id INTEGER,
  clave_idempotencia TEXT,         -- evita movimientos duplicados por reintentos
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  observaciones TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mov_prod ON movimientos_inventario(producto_id, fecha);
CREATE INDEX idx_mov_lc ON movimientos_inventario(lote_cosecha_id);
CREATE INDEX idx_mov_lote ON movimientos_inventario(lote_id);
CREATE UNIQUE INDEX uq_mov_idem ON movimientos_inventario(finca_id, clave_idempotencia) WHERE clave_idempotencia IS NOT NULL;

-- ===================== M3 · ASISTENCIA / JORNALES / PAGOS =====================
CREATE TABLE asistencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  trabajador_id INTEGER NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('presente','ausente','retraso')),
  hora_entrada TEXT,
  justificacion TEXT,
  UNIQUE (trabajador_id, fecha)
);
CREATE INDEX idx_asist_fecha ON asistencias(finca_id, fecha);

CREATE TABLE pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  trabajador_id INTEGER NOT NULL REFERENCES trabajadores(id) ON DELETE RESTRICT,
  fecha TEXT NOT NULL,
  periodo_desde TEXT NOT NULL,
  periodo_hasta TEXT NOT NULL,
  bruto REAL NOT NULL CHECK (bruto >= 0),
  anticipos_descontados REAL NOT NULL DEFAULT 0 CHECK (anticipos_descontados >= 0),
  neto REAL NOT NULL CHECK (neto >= 0),
  metodo TEXT NOT NULL DEFAULT 'efectivo',
  observaciones TEXT,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);
CREATE INDEX idx_pagos_trab ON pagos(trabajador_id, fecha);

CREATE TABLE jornales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  trabajador_id INTEGER NOT NULL REFERENCES trabajadores(id) ON DELETE RESTRICT,
  fecha TEXT NOT NULL,
  jornadas REAL NOT NULL CHECK (jornadas > 0 AND jornadas <= 3),
  tarifa REAL NOT NULL CHECK (tarifa >= 0),
  monto REAL NOT NULL CHECK (monto >= 0),
  lote_id INTEGER REFERENCES lotes(id) ON DELETE SET NULL,
  labor_id INTEGER REFERENCES labores(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL DEFAULT 'campo',   -- campo, cosecha, vivero, otro
  pago_id INTEGER REFERENCES pagos(id) ON DELETE SET NULL,
  observaciones TEXT
);
CREATE INDEX idx_jor_trab ON jornales(trabajador_id, fecha);
CREATE INDEX idx_jor_pago ON jornales(pago_id);
CREATE INDEX idx_jor_lote ON jornales(lote_id);

CREATE TABLE anticipos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  trabajador_id INTEGER NOT NULL REFERENCES trabajadores(id) ON DELETE RESTRICT,
  fecha TEXT NOT NULL,
  monto REAL NOT NULL CHECK (monto > 0),
  motivo TEXT,
  pago_id INTEGER REFERENCES pagos(id) ON DELETE SET NULL   -- pago en el que fue descontado
);
CREATE INDEX idx_antic_trab ON anticipos(trabajador_id, pago_id);

-- ===================== M5 · VENTAS Y CLIENTES =====================
CREATE TABLE clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  documento TEXT,
  telefono TEXT, email TEXT, direccion TEXT,
  consentimiento_contacto INTEGER NOT NULL DEFAULT 0,
  notas TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_clientes_finca ON clientes(finca_id, nombre);

-- ===================== M6 · VIVERO =====================
CREATE TABLE viveros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  ubicacion TEXT,
  UNIQUE (finca_id, nombre)
);
CREATE TABLE especies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  variedad TEXT,
  tipo TEXT,
  dias_germinacion INTEGER CHECK (dias_germinacion IS NULL OR dias_germinacion > 0),
  precio_plantin REAL CHECK (precio_plantin IS NULL OR precio_plantin >= 0),
  UNIQUE (finca_id, nombre, variedad)
);
CREATE TABLE siembras_vivero (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  vivero_id INTEGER NOT NULL REFERENCES viveros(id) ON DELETE RESTRICT,
  especie_id INTEGER NOT NULL REFERENCES especies(id) ON DELETE RESTRICT,
  codigo TEXT NOT NULL,
  fecha_siembra TEXT NOT NULL,
  cantidad_sembrada INTEGER NOT NULL CHECK (cantidad_sembrada > 0),
  estado TEXT NOT NULL DEFAULT 'en_proceso' CHECK (estado IN ('en_proceso','disponible','agotada','cerrada')),
  observaciones TEXT,
  UNIQUE (finca_id, codigo)
);
-- Libro de movimientos del vivero. Plantines existentes/disponibles/vendidos se derivan de aquí.
CREATE TABLE movimientos_vivero (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  siembra_id INTEGER NOT NULL REFERENCES siembras_vivero(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('germinacion','perdida','venta','trasplante','crecimiento')),
  cantidad INTEGER NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  fecha TEXT NOT NULL,
  altura_cm REAL,
  venta_id INTEGER,
  observaciones TEXT
);
CREATE INDEX idx_movviv_siembra ON movimientos_vivero(siembra_id, tipo);

-- Ventas
CREATE TABLE pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  fecha TEXT NOT NULL,
  fecha_entrega TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','confirmado','convertido','cancelado')),
  observaciones TEXT,
  venta_id INTEGER
);
CREATE TABLE pedido_detalles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad REAL NOT NULL CHECK (cantidad > 0),
  precio_unitario REAL NOT NULL CHECK (precio_unitario >= 0)
);

CREATE TABLE ventas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  pedido_id INTEGER REFERENCES pedidos(id) ON DELETE SET NULL,
  fecha TEXT NOT NULL,
  subtotal REAL NOT NULL CHECK (subtotal >= 0),
  descuento REAL NOT NULL DEFAULT 0 CHECK (descuento >= 0),   -- suma de descuentos por línea
  total REAL NOT NULL CHECK (total >= 0),
  metodo_pago TEXT NOT NULL DEFAULT 'efectivo' CHECK (metodo_pago IN ('efectivo','transferencia','qr','tarjeta','credito')),
  estado TEXT NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('borrador','confirmada','anulada')),
  fecha_vencimiento TEXT,
  observaciones TEXT,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (finca_id, numero)
);
CREATE INDEX idx_ventas_fecha ON ventas(finca_id, fecha);
CREATE INDEX idx_ventas_cliente ON ventas(cliente_id);

CREATE TABLE detalle_venta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id INTEGER REFERENCES productos(id) ON DELETE RESTRICT,
  lote_cosecha_id INTEGER REFERENCES lotes_cosecha(id) ON DELETE RESTRICT,  -- trazabilidad venta → lote de cosecha
  siembra_id INTEGER REFERENCES siembras_vivero(id) ON DELETE RESTRICT,     -- venta de plantines
  descripcion TEXT NOT NULL,
  cantidad REAL NOT NULL CHECK (cantidad > 0),
  precio_unitario REAL NOT NULL CHECK (precio_unitario >= 0),
  descuento REAL NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  subtotal REAL NOT NULL CHECK (subtotal >= 0),
  CHECK ((producto_id IS NOT NULL) <> (siembra_id IS NOT NULL))
);
CREATE INDEX idx_det_venta ON detalle_venta(venta_id);
CREATE INDEX idx_det_lc ON detalle_venta(lote_cosecha_id);

CREATE TABLE cuentas_por_cobrar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  venta_id INTEGER NOT NULL UNIQUE REFERENCES ventas(id) ON DELETE CASCADE,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  monto_total REAL NOT NULL CHECK (monto_total >= 0),
  saldo REAL NOT NULL CHECK (saldo >= 0),
  fecha_vencimiento TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','parcial','pagada','anulada'))
);
CREATE INDEX idx_cxc_estado ON cuentas_por_cobrar(finca_id, estado);

CREATE TABLE pagos_venta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  venta_id INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  cuenta_id INTEGER NOT NULL REFERENCES cuentas_por_cobrar(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  monto REAL NOT NULL CHECK (monto > 0),
  metodo TEXT NOT NULL DEFAULT 'efectivo',
  referencia TEXT,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);
CREATE INDEX idx_pv_venta ON pagos_venta(venta_id);

-- ===================== M7 · FINANZAS (registros manuales) =====================
-- Los costos de insumos (movimientos de salida) y jornales se leen de sus tablas origen; aquí solo gastos/ingresos manuales.
CREATE TABLE gastos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  categoria TEXT NOT NULL CHECK (categoria IN ('cosecha','mantenimiento','servicios','transporte','vivero','otros')),
  descripcion TEXT NOT NULL,
  monto REAL NOT NULL CHECK (monto > 0),
  lote_id INTEGER REFERENCES lotes(id) ON DELETE SET NULL,
  plantacion_id INTEGER REFERENCES plantaciones(id) ON DELETE SET NULL,
  siembra_id INTEGER REFERENCES siembras_vivero(id) ON DELETE SET NULL,
  proveedor_id INTEGER REFERENCES proveedores(id) ON DELETE SET NULL
);
CREATE INDEX idx_gastos_fecha ON gastos(finca_id, fecha);
CREATE TABLE ingresos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'otros',
  descripcion TEXT NOT NULL,
  monto REAL NOT NULL CHECK (monto > 0)
);
CREATE INDEX idx_ingresos_fecha ON ingresos(finca_id, fecha);

-- ===================== TRANSVERSAL =====================
CREATE TABLE auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER,
  usuario_id INTEGER,
  accion TEXT NOT NULL,
  entidad TEXT,
  entidad_id TEXT,
  detalle TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_aud_finca ON auditoria(finca_id, created_at);

-- Reservadas para integraciones futuras (WhatsApp / IA). Hoy no son escritas por ningún flujo activo.
CREATE TABLE integracion_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER,
  canal TEXT NOT NULL,             -- whatsapp | ia
  direccion TEXT NOT NULL CHECK (direccion IN ('entrante','saliente')),
  proveedor TEXT,
  tipo TEXT,
  payload TEXT,
  estado TEXT NOT NULL DEFAULT 'recibido',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE acciones_pendientes (   -- propuestas (p.ej. de IA) que requieren confirmación humana antes de guardarse
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finca_id INTEGER NOT NULL,
  usuario_id INTEGER,
  origen TEXT NOT NULL,
  tipo TEXT NOT NULL,              -- p.ej. cosecha, labor
  payload TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','confirmada','rechazada','expirada')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resuelta_at TEXT
);
