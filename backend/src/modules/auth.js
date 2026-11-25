import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { createApi } from '../core/api.js';
import { z, str, email, password, optStr, optNum } from '../core/schemas.js';
import { db, tx } from '../db/index.js';
import { config } from '../config/env.js';
import { signToken, modulosActivos } from '../middleware/auth.js';
import { unauthorized, badRequest, forbidden } from '../core/errors.js';
import { audit } from '../core/audit.js';

export const api = createApi('Autenticación', { prefix: '/auth' });

const loginLimiter = rateLimit({ windowMs: config.rateLimit.windowMs, limit: config.rateLimit.loginMax, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Demasiados intentos. Intenta más tarde.' } } });
const DUMMY_HASH = bcrypt.hashSync('dummy-password-0', 4);

function perfil(userId) {
  const u = db.prepare(`SELECT u.id, u.nombre, u.email, u.finca_id, r.codigo AS rol, r.nombre AS rol_nombre, f.nombre AS finca_nombre, f.moneda
    FROM usuarios u JOIN roles r ON r.id = u.rol_id JOIN fincas f ON f.id = u.finca_id WHERE u.id = ?`).get(userId);
  const permisos = db.prepare('SELECT p.codigo FROM rol_permisos rp JOIN permisos p ON p.id=rp.permiso_id JOIN roles r ON r.id=rp.rol_id WHERE r.codigo=? ORDER BY p.codigo').all(u.rol).map(x => x.codigo);
  return { usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, rol_nombre: u.rol_nombre }, finca: { id: u.finca_id, nombre: u.finca_nombre, moneda: u.moneda }, permisos, modulos: modulosActivos(u.finca_id) };
}

api.post('/registro', {
  summary: 'Registrar una nueva finca con su usuario propietario',
  public: true,
  body: z.object({
    finca: z.object({ nombre: str(120), ubicacion: optStr(200), superficie_ha: optNum({ min: 0 }), moneda: z.string().trim().max(5).default('BOB') }),
    nombre: str(100), email: email(), password: password(),
  }),
}, (req, res) => {
  if (!config.allowRegistration) throw forbidden('El registro público está deshabilitado');
  const b = req.body;
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(b.email)) throw badRequest('Ya existe un usuario con ese email');
  const hash = bcrypt.hashSync(b.password, config.bcryptRounds);
  const user = tx(() => {
    const f = db.prepare('INSERT INTO fincas (nombre, ubicacion, superficie_ha, moneda) VALUES (?,?,?,?)').run(b.finca.nombre, b.finca.ubicacion ?? null, b.finca.superficie_ha ?? null, b.finca.moneda);
    db.prepare('INSERT INTO modulos_activos (finca_id, modulo_id, activo) SELECT ?, id, 1 FROM modulos').run(f.lastInsertRowid);
    const rol = db.prepare("SELECT id FROM roles WHERE codigo='propietario'").get();
    const u = db.prepare('INSERT INTO usuarios (finca_id, rol_id, nombre, email, password_hash) VALUES (?,?,?,?,?)').run(f.lastInsertRowid, rol.id, b.nombre, b.email, hash);
    return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(u.lastInsertRowid);
  });
  audit(req, { accion: 'registro_finca', entidad: 'fincas', id: user.finca_id, fincaId: user.finca_id, usuarioId: user.id });
  return { token: signToken(user), ...perfil(user.id) };
});

api.post('/login', { summary: 'Iniciar sesión (limitado por intentos)', public: true, status: 200, use: [loginLimiter], body: z.object({ email: email(), password: z.string().min(1).max(100) }) }, (req) => {
  const { email: em, password: pw } = req.body;
  const u = db.prepare('SELECT u.*, f.activa FROM usuarios u JOIN fincas f ON f.id = u.finca_id WHERE u.email = ?').get(em);
  const ok = bcrypt.compareSync(pw, u?.password_hash ?? DUMMY_HASH);   // evita enumerar usuarios por tiempo de respuesta
  if (!u || !ok || !u.activo || !u.activa) {
    audit(req, { accion: 'login_fallido', entidad: 'usuarios', detalle: { email: em }, fincaId: u?.finca_id });
    throw unauthorized('Credenciales inválidas');
  }
  db.prepare("UPDATE usuarios SET ultimo_login = datetime('now') WHERE id = ?").run(u.id);
  audit(req, { accion: 'login', entidad: 'usuarios', id: u.id, fincaId: u.finca_id, usuarioId: u.id });
  return { token: signToken(u), ...perfil(u.id) };
});

api.get('/me', { summary: 'Perfil, permisos y módulos activos del usuario autenticado' }, (req) => perfil(req.user.id));

api.post('/logout', { summary: 'Cerrar sesión (invalida todos los tokens del usuario)', status: 200 }, (req) => {
  db.prepare('UPDATE usuarios SET token_version = token_version + 1 WHERE id = ?').run(req.user.id);
  audit(req, { accion: 'logout', entidad: 'usuarios', id: req.user.id });
  return { ok: true };
});

api.post('/cambiar-password', {
  summary: 'Cambiar la contraseña propia', status: 200,
  body: z.object({ actual: z.string().min(1), nueva: password() }),
}, (req) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(req.body.actual, u.password_hash)) throw badRequest('La contraseña actual es incorrecta');
  db.prepare('UPDATE usuarios SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(bcrypt.hashSync(req.body.nueva, config.bcryptRounds), u.id);
  audit(req, { accion: 'cambio_password', entidad: 'usuarios', id: u.id });
  const nuevo = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(u.id);
  return { ok: true, token: signToken(nuevo) };
});

// Recuperación local: no se envía correo (sin proveedores externos). El token se escribe en la consola del servidor
// y, solo en desarrollo (EXPOSE_RESET_TOKEN=true), se devuelve en la respuesta. En producción conectar un servicio de correo.
api.post('/olvide-password', { summary: 'Solicitar token de recuperación de contraseña (mecanismo local)', public: true, status: 200, body: z.object({ email: email() }) }, (req) => {
  const u = db.prepare('SELECT id, finca_id FROM usuarios WHERE email = ? AND activo = 1').get(req.body.email);
  const out = { mensaje: 'Si el email existe, se generó un token de recuperación válido por 30 minutos.' };
  if (u) {
    const token = crypto.randomBytes(24).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    db.prepare("UPDATE usuarios SET reset_token_hash = ?, reset_expira = datetime('now','+30 minutes') WHERE id = ?").run(hash, u.id);
    audit(req, { accion: 'solicitud_reset_password', entidad: 'usuarios', id: u.id, fincaId: u.finca_id, usuarioId: u.id });
    console.log(`[recuperación] token para ${req.body.email}: ${token}`);
    if (config.exposeResetToken) out.token_desarrollo = token;
  }
  return out;
});

api.post('/restablecer-password', { summary: 'Restablecer contraseña con token', public: true, status: 200, body: z.object({ token: z.string().min(20).max(100), password: password() }) }, (req) => {
  const hash = crypto.createHash('sha256').update(req.body.token).digest('hex');
  const u = db.prepare("SELECT id FROM usuarios WHERE reset_token_hash = ? AND reset_expira > datetime('now')").get(hash);
  if (!u) throw badRequest('Token inválido o expirado');
  db.prepare('UPDATE usuarios SET password_hash = ?, reset_token_hash = NULL, reset_expira = NULL, token_version = token_version + 1 WHERE id = ?').run(bcrypt.hashSync(req.body.password, config.bcryptRounds), u.id);
  audit(req, { accion: 'reset_password', entidad: 'usuarios', id: u.id });
  return { ok: true };
});
