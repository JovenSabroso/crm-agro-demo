// Datos de referencia (NO son datos de demostración): roles, permisos y módulos. Idempotente.
export const MODULOS = [
  { codigo: 'M0', nombre: 'Núcleo', descripcion: 'Finca, usuarios, roles, lotes, cultivos y campañas', obligatorio: 1 },
  { codigo: 'M1', nombre: 'Control técnico de campo', descripcion: 'Labores, riego, aplicaciones fitosanitarias y cosechas', obligatorio: 0 },
  { codigo: 'M2', nombre: 'Trazabilidad', descripcion: 'Códigos QR y ficha pública de trazabilidad', obligatorio: 0 },
  { codigo: 'M3', nombre: 'Trabajadores', descripcion: 'Asistencia, tareas, jornales y pagos', obligatorio: 0 },
  { codigo: 'M4', nombre: 'Inventarios', descripcion: 'Insumos y productos cosechados', obligatorio: 0 },
  { codigo: 'M5', nombre: 'Ventas y clientes', descripcion: 'Clientes, pedidos, ventas y cuentas por cobrar', obligatorio: 0 },
  { codigo: 'M6', nombre: 'Vivero', descripcion: 'Producción y venta de plantines', obligatorio: 0 },
  { codigo: 'M7', nombre: 'Reportes y finanzas', descripcion: 'Costos, ingresos, márgenes y reportes', obligatorio: 0 },
];

export const PERMISOS = {
  'finca:admin': 'Editar datos y configuración de la finca',
  'usuarios:admin': 'Administrar usuarios y roles',
  'modulos:admin': 'Activar o desactivar módulos',
  'auditoria:read': 'Consultar la bitácora de auditoría',
  'lotes:read': 'Ver lotes, cultivos y campañas',
  'lotes:write': 'Gestionar lotes, cultivos y campañas',
  'campo:read': 'Ver labores, riegos, aplicaciones y cosechas',
  'campo:write': 'Registrar labores, riegos, aplicaciones y cosechas',
  'trazabilidad:read': 'Consultar trazabilidad interna',
  'trazabilidad:write': 'Generar y gestionar QR de lotes de cosecha',
  'trabajadores:read': 'Ver trabajadores y asistencia',
  'trabajadores:write': 'Gestionar trabajadores, asistencia y tareas',
  'pagos:write': 'Registrar jornales, anticipos y pagos',
  'inventario:read': 'Ver inventario',
  'inventario:write': 'Registrar movimientos de inventario',
  'ventas:read': 'Ver ventas y clientes',
  'ventas:write': 'Registrar ventas, clientes y cobros',
  'vivero:read': 'Ver vivero',
  'vivero:write': 'Gestionar vivero',
  'finanzas:read': 'Ver reportes y finanzas',
  'finanzas:write': 'Registrar gastos e ingresos manuales',
};

const ALL = Object.keys(PERMISOS);
export const ROLES = {
  propietario: { nombre: 'Propietario', permisos: ALL },
  encargado: {
    nombre: 'Encargado',
    permisos: ALL.filter(p => !['finca:admin', 'usuarios:admin', 'modulos:admin', 'auditoria:read', 'pagos:write', 'finanzas:read', 'finanzas:write'].includes(p)),
  },
  trabajador: {
    nombre: 'Trabajador',
    permisos: ['lotes:read', 'campo:read', 'campo:write', 'trazabilidad:read', 'inventario:read', 'vivero:read'],
  },
};

export function ensureCatalog(db) {
  db.transaction(() => {
    for (const m of MODULOS) {
      db.prepare(`INSERT INTO modulos (codigo,nombre,descripcion,obligatorio) VALUES (?,?,?,?)
        ON CONFLICT(codigo) DO UPDATE SET nombre=excluded.nombre, descripcion=excluded.descripcion, obligatorio=excluded.obligatorio`)
        .run(m.codigo, m.nombre, m.descripcion, m.obligatorio);
    }
    for (const [codigo, d] of Object.entries(PERMISOS)) {
      db.prepare('INSERT INTO permisos (codigo,descripcion) VALUES (?,?) ON CONFLICT(codigo) DO UPDATE SET descripcion=excluded.descripcion').run(codigo, d);
    }
    for (const [codigo, r] of Object.entries(ROLES)) {
      db.prepare('INSERT INTO roles (codigo,nombre) VALUES (?,?) ON CONFLICT(codigo) DO UPDATE SET nombre=excluded.nombre').run(codigo, r.nombre);
      const rolId = db.prepare('SELECT id FROM roles WHERE codigo=?').get(codigo).id;
      db.prepare('DELETE FROM rol_permisos WHERE rol_id=?').run(rolId);
      for (const p of r.permisos) {
        db.prepare('INSERT INTO rol_permisos (rol_id, permiso_id) SELECT ?, id FROM permisos WHERE codigo=?').run(rolId, p);
      }
    }
  })();
}
