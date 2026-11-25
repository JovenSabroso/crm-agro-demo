import bcrypt from 'bcryptjs';
import { createApi, Page } from '../core/api.js';
import { crud } from '../core/crud.js';
import { z, str, optStr, optNum, optInt, optDate, date, id, enm, email, password, bool, listQuery } from '../core/schemas.js';
import { db } from '../db/index.js';
import { config } from '../config/env.js';
import { notFound, badRequest, unprocessable, conflict } from '../core/errors.js';
import { audit } from '../core/audit.js';
import { modulosActivos } from '../middleware/auth.js';

// ---------- Finca y configuración ----------
export const finca = createApi('M0 · Finca y configuración', { prefix: '/finca', module: 'M0' });
const fincaSchema = z.object({
  nombre: str(120), ubicacion: optStr(200), latitud: optNum({ min: -90, max: 90 }), longitud: optNum({ min: -180, max: 180 }),
  superficie_ha: optNum({ min: 0 }), moneda: z.string().trim().min(1).max(5), telefono: optStr(30), descripcion: optStr(500),
});
finca.get('/', { summary: 'Datos de la finca actual', perm: 'lotes:read' }, (req) => {
  const f = db.prepare('SELECT * FROM fincas WHERE id = ?').get(req.user.fincaId);
  return { ...f, modulos_activos: modulosActivos(f.id) };
});
finca.put('/', { summary: 'Actualizar datos y configuración general de la finca', perm: 'finca:admin', body: fincaSchema.partial() }, (req) => {
  const keys = Object.keys(req.body).filter(k => req.body[k] !== undefined);
  if (keys.length) db.prepare(`UPDATE fincas SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map(k => req.body[k]), req.user.fincaId);
  audit(req, { accion: 'actualizar', entidad: 'fincas', id: req.user.fincaId, detalle: req.body });
  return db.prepare('SELECT * FROM fincas WHERE id = ?').get(req.user.fincaId);
});

// ---------- Módulos activables ----------
export const modulos = createApi('M0 · Módulos', { prefix: '/modulos' });
modulos.get('/', { summary: 'Listar módulos y su estado en la finca' }, (req) =>
  db.prepare(`SELECT m.codigo, m.nombre, m.descripcion, m.obligatorio,
      CASE WHEN m.obligatorio = 1 OR ma.activo = 1 THEN 1 ELSE 0 END AS activo
    FROM modulos m LEFT JOIN modulos_activos ma ON ma.modulo_id = m.id AND ma.finca_id = ? ORDER BY m.codigo`).all(req.user.fincaId));
modulos.put('/:codigo', { summary: 'Activar o desactivar un módulo de la finca', perm: 'modulos:admin', body: z.object({ activo: bool() }) }, (req) => {
  const m = db.prepare('SELECT * FROM modulos WHERE codigo = ?').get(req.params.codigo.toUpperCase());
  if (!m) throw notFound('Módulo inexistente');
  if (m.obligatorio) throw unprocessable('El módulo Núcleo (M0) es obligatorio y no puede desactivarse');
  db.prepare(`INSERT INTO modulos_activos (finca_id, modulo_id, activo) VALUES (?,?,?) ON CONFLICT(finca_id, modulo_id) DO UPDATE SET activo = excluded.activo`).run(req.user.fincaId, m.id, req.body.activo);
  audit(req, { accion: req.body.activo ? 'activar_modulo' : 'desactivar_modulo', entidad: 'modulos', id: m.codigo });
  return { codigo: m.codigo, activo: req.body.activo, modulos_activos: modulosActivos(req.user.fincaId) };
});

// ---------- Roles ----------
export const roles = createApi('M0 · Usuarios y roles', { prefix: '/roles' });
roles.get('/', { summary: 'Roles y permisos disponibles', perm: 'usuarios:admin' }, () => {
  const rs = db.prepare('SELECT id, codigo, nombre FROM roles ORDER BY id').all();
  return rs.map(r => ({ ...r, permisos: db.prepare('SELECT p.codigo, p.descripcion FROM rol_permisos rp JOIN permisos p ON p.id=rp.permiso_id WHERE rp.rol_id=? ORDER BY p.codigo').all(r.id) }));
});

// ---------- Usuarios ----------
export const usuarios = createApi('M0 · Usuarios y roles', { prefix: '/usuarios', module: 'M0' });
const userCols = 'u.id, u.nombre, u.email, u.activo, u.ultimo_login, u.created_at, r.codigo AS rol, r.nombre AS rol_nombre';
const ROLES = ['propietario', 'encargado', 'trabajador'];
const rolId = (codigo) => db.prepare('SELECT id FROM roles WHERE codigo=?').get(codigo).id;
function assertNotLastOwner(fincaId, userId) {
  const owners = db.prepare("SELECT u.id FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE u.finca_id=? AND r.codigo='propietario' AND u.activo=1").all(fincaId);
  if (owners.length === 1 && owners[0].id === userId) throw unprocessable('Debe existir al menos un propietario activo en la finca');
}

usuarios.get('/', { summary: 'Listar usuarios de la finca', perm: 'usuarios:admin', query: listQuery }, (req) => {
  const q = req.q; const where = ['u.finca_id = ?']; const args = [req.user.fincaId];
  if (q.q) { where.push('(u.nombre LIKE ? OR u.email LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
  if (q.rol) { where.push('r.codigo = ?'); args.push(q.rol); }
  const total = db.prepare(`SELECT COUNT(*) c FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`SELECT ${userCols} FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE ${where.join(' AND ')} ORDER BY u.nombre LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize);
  return new Page(rows, { page: q.page, pageSize: q.pageSize, total });
});
usuarios.post('/', { summary: 'Crear usuario', perm: 'usuarios:admin', body: z.object({ nombre: str(100), email: email(), password: password(), rol: enm(ROLES) }) }, (req) => {
  const b = req.body;
  if (db.prepare('SELECT 1 FROM usuarios WHERE email=?').get(b.email)) throw conflict('Ya existe un usuario con ese email');
  const info = db.prepare('INSERT INTO usuarios (finca_id, rol_id, nombre, email, password_hash) VALUES (?,?,?,?,?)').run(req.user.fincaId, rolId(b.rol), b.nombre, b.email, bcrypt.hashSync(b.password, config.bcryptRounds));
  audit(req, { accion: 'crear', entidad: 'usuarios', id: info.lastInsertRowid, detalle: { email: b.email, rol: b.rol } });
  return db.prepare(`SELECT ${userCols} FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE u.id=?`).get(info.lastInsertRowid);
});
usuarios.put('/:id', { summary: 'Actualizar usuario (nombre, rol, estado)', perm: 'usuarios:admin', body: z.object({ nombre: str(100), rol: enm(ROLES), activo: bool() }).partial() }, (req) => {
  const uid = Number(req.params.id);
  const u = db.prepare('SELECT u.*, r.codigo AS rol FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE u.id=? AND u.finca_id=?').get(uid, req.user.fincaId);
  if (!u) throw notFound('Usuario no encontrado');
  const b = req.body;
  if ((b.rol && b.rol !== 'propietario' && u.rol === 'propietario') || (b.activo === 0 && u.rol === 'propietario')) assertNotLastOwner(req.user.fincaId, uid);
  if (b.activo === 0 && uid === req.user.id) throw unprocessable('No puedes desactivar tu propia cuenta');
  if (b.nombre) db.prepare('UPDATE usuarios SET nombre=? WHERE id=?').run(b.nombre, uid);
  if (b.rol) db.prepare('UPDATE usuarios SET rol_id=?, token_version=token_version+1 WHERE id=?').run(rolId(b.rol), uid);
  if (b.activo !== undefined) db.prepare('UPDATE usuarios SET activo=?, token_version=token_version+1 WHERE id=?').run(b.activo, uid);
  audit(req, { accion: 'actualizar', entidad: 'usuarios', id: uid, detalle: b });
  return db.prepare(`SELECT ${userCols} FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE u.id=?`).get(uid);
});
usuarios.post('/:id/password', { summary: 'Restablecer la contraseña de un usuario (administrador)', perm: 'usuarios:admin', status: 200, body: z.object({ password: password() }) }, (req) => {
  const uid = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM usuarios WHERE id=? AND finca_id=?').get(uid, req.user.fincaId)) throw notFound('Usuario no encontrado');
  db.prepare('UPDATE usuarios SET password_hash=?, token_version=token_version+1 WHERE id=?').run(bcrypt.hashSync(req.body.password, config.bcryptRounds), uid);
  audit(req, { accion: 'reset_password_admin', entidad: 'usuarios', id: uid });
  return { ok: true };
});

// ---------- Lotes, cultivos, campañas, plantaciones ----------
export const lotes = createApi('M0 · Lotes y cultivos', { prefix: '/lotes', module: 'M0' });
const loteSchema = z.object({
  codigo: str(30), nombre: str(100), superficie_ha: optNum({ min: 0 }), tipo_suelo: optStr(60),
  latitud: optNum({ min: -90, max: 90 }), longitud: optNum({ min: -180, max: 180 }),
  estado: enm(['activo', 'descanso', 'inactivo']).default('activo'), observaciones: optStr(500),
});
lotes.get('/resumen', { summary: 'Lotes con su cultivo activo, labores pendientes y producción', perm: 'lotes:read' }, (req) =>
  db.prepare(`SELECT l.id, l.codigo, l.nombre, l.superficie_ha, l.estado, l.latitud, l.longitud,
      c.nombre AS cultivo, c.variedad, p.id AS plantacion_id, p.fecha_siembra, p.fecha_cosecha_estimada,
      (SELECT COUNT(*) FROM labores lb WHERE lb.lote_id = l.id AND lb.estado IN ('pendiente','en_curso')) AS labores_pendientes,
      (SELECT COALESCE(SUM(cantidad),0) FROM cosechas co WHERE co.lote_id = l.id) AS cosechado
    FROM lotes l LEFT JOIN plantaciones p ON p.lote_id = l.id AND p.estado = 'activo' LEFT JOIN cultivos c ON c.id = p.cultivo_id
    WHERE l.finca_id = ? ORDER BY l.codigo`).all(req.user.fincaId));
crud(lotes, {
  name: 'lote', table: 'lotes', perm: 'lotes', create: loteSchema, search: ['x.codigo', 'x.nombre'],
  filters: { estado: 'x.estado' }, sorts: { codigo: 'x.codigo', nombre: 'x.nombre', superficie_ha: 'x.superficie_ha' }, defaultSort: 'codigo ASC',
});

export const cultivos = createApi('M0 · Lotes y cultivos', { prefix: '/cultivos', module: 'M0' });
crud(cultivos, {
  name: 'cultivo', table: 'cultivos', perm: 'lotes',
  create: z.object({ nombre: str(80), variedad: optStr(80), tipo: enm(['hortaliza', 'fruta', 'cereal', 'tuberculo', 'forraje', 'otro']).default('hortaliza'), ciclo_dias: optInt({ min: 1 }), unidad_cosecha: str(15).default('kg') }),
  search: ['x.nombre', 'x.variedad'], filters: { tipo: 'x.tipo' }, sorts: { nombre: 'x.nombre' }, defaultSort: 'nombre ASC',
});

export const campanas = createApi('M0 · Campañas', { prefix: '/campanas', module: 'M0' });
crud(campanas, {
  name: 'campaña', table: 'campanas', perm: 'lotes',
  create: z.object({ nombre: str(80), fecha_inicio: date(), fecha_fin: optDate(), estado: enm(['planificada', 'activa', 'cerrada']).default('activa'), observaciones: optStr(300) })
    .refine(d => !d.fecha_fin || d.fecha_fin >= d.fecha_inicio, { message: 'La fecha de fin no puede ser anterior al inicio', path: ['fecha_fin'] }),
  update: z.object({ nombre: str(80), fecha_inicio: date(), fecha_fin: optDate(), estado: enm(['planificada', 'activa', 'cerrada']), observaciones: optStr(300) }).partial(),
  search: ['x.nombre'], filters: { estado: 'x.estado' }, sorts: { fecha_inicio: 'x.fecha_inicio', nombre: 'x.nombre' }, defaultSort: 'fecha_inicio DESC',
});

export const plantaciones = createApi('M0 · Lotes y cultivos', { prefix: '/plantaciones', module: 'M0' });
crud(plantaciones, {
  name: 'plantación (cultivo en lote)', table: 'plantaciones', perm: 'lotes',
  create: z.object({ lote_id: id(), cultivo_id: id(), campana_id: z.preprocess(v => v === '' ? null : v, id().nullable().optional()), fecha_siembra: date(), fecha_cosecha_estimada: optDate(), superficie_ha: optNum({ min: 0 }), estado: enm(['activo', 'cosechado', 'cerrado']).default('activo'), observaciones: optStr(300) })
    .refine(d => !d.fecha_cosecha_estimada || d.fecha_cosecha_estimada >= d.fecha_siembra, { message: 'La cosecha estimada no puede ser anterior a la siembra', path: ['fecha_cosecha_estimada'] }),
  update: z.object({ campana_id: z.preprocess(v => v === '' ? null : v, id().nullable().optional()), fecha_siembra: date(), fecha_cosecha_estimada: optDate(), superficie_ha: optNum({ min: 0 }), estado: enm(['activo', 'cosechado', 'cerrado']), observaciones: optStr(300) }).partial(),
  owned: { lote_id: 'lotes', cultivo_id: 'cultivos', campana_id: 'campanas' },
  select: 'lo.codigo AS lote_codigo, lo.nombre AS lote_nombre, cu.nombre AS cultivo_nombre, cu.variedad AS cultivo_variedad, ca.nombre AS campana_nombre',
  joins: 'JOIN lotes lo ON lo.id = x.lote_id JOIN cultivos cu ON cu.id = x.cultivo_id LEFT JOIN campanas ca ON ca.id = x.campana_id',
  search: ['lo.codigo', 'lo.nombre', 'cu.nombre'], filters: { estado: 'x.estado', lote_id: 'x.lote_id', cultivo_id: 'x.cultivo_id', campana_id: 'x.campana_id' },
  sorts: { fecha_siembra: 'x.fecha_siembra', lote: 'lo.codigo', cultivo: 'cu.nombre' }, defaultSort: 'fecha_siembra DESC',
  before(data, req, existing) {
    const estado = data.estado ?? existing?.estado ?? 'activo';
    const loteId = data.lote_id ?? existing?.lote_id;
    if (estado === 'activo') {
      const otra = db.prepare("SELECT id FROM plantaciones WHERE lote_id=? AND estado='activo' AND id<>?").get(loteId, existing?.id ?? 0);
      if (otra) throw conflict('El lote ya tiene un cultivo activo. Cierra o marca como cosechado el anterior antes de sembrar otro.');
    }
    return data;
  },
});

// ---------- Auditoría ----------
export const auditoria = createApi('M0 · Auditoría', { prefix: '/auditoria', module: 'M0' });
auditoria.get('/', { summary: 'Bitácora de operaciones importantes', perm: 'auditoria:read', query: listQuery }, (req) => {
  const q = req.q; const where = ['a.finca_id = ?']; const args = [req.user.fincaId];
  if (q.q) { where.push('(a.accion LIKE ? OR a.entidad LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
  if (q.desde) { where.push('date(a.created_at) >= ?'); args.push(q.desde); }
  if (q.hasta) { where.push('date(a.created_at) <= ?'); args.push(q.hasta); }
  const total = db.prepare(`SELECT COUNT(*) c FROM auditoria a WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`SELECT a.id, a.accion, a.entidad, a.entidad_id, a.detalle, a.ip, a.created_at, u.nombre AS usuario
    FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize);
  return new Page(rows, { page: q.page, pageSize: q.pageSize, total });
});
