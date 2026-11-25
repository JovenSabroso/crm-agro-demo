import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { db } from '../db/index.js';
import { unauthorized, forbidden } from '../core/errors.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, fid: user.finca_id, tv: user.token_version }, config.jwtSecret, { expiresIn: config.jwtExpiresIn, algorithm: 'HS256' });
}

export function authenticate(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(unauthorized('Falta el token de acceso'));
  let payload;
  try { payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }); }
  catch (e) { return next(unauthorized(e.name === 'TokenExpiredError' ? 'La sesión expiró' : 'Token inválido')); }

  const u = db.prepare(`SELECT u.id, u.finca_id, u.nombre, u.email, u.activo, u.token_version, r.codigo AS rol, f.activa AS finca_activa
    FROM usuarios u JOIN roles r ON r.id = u.rol_id JOIN fincas f ON f.id = u.finca_id WHERE u.id = ?`).get(payload.sub);
  if (!u || !u.activo || !u.finca_activa) return next(unauthorized('Usuario inactivo o inexistente'));
  if (u.token_version !== payload.tv) return next(unauthorized('Sesión cerrada, inicia sesión nuevamente'));

  const perms = db.prepare(`SELECT p.codigo FROM rol_permisos rp JOIN permisos p ON p.id = rp.permiso_id JOIN roles r ON r.id = rp.rol_id WHERE r.codigo = ?`).all(u.rol).map(x => x.codigo);
  req.user = { id: u.id, fincaId: u.finca_id, nombre: u.nombre, email: u.email, rol: u.rol, permisos: new Set(perms) };
  next();
}

export const requirePerm = (perm) => (req, _res, next) =>
  req.user?.permisos.has(perm) ? next() : next(forbidden(`Permiso requerido: ${perm}`));

export function modulosActivos(fincaId) {
  return db.prepare(`SELECT m.codigo FROM modulos m LEFT JOIN modulos_activos ma ON ma.modulo_id = m.id AND ma.finca_id = ?
    WHERE m.obligatorio = 1 OR ma.activo = 1`).all(fincaId).map(r => r.codigo);
}
export const isModuleActive = (fincaId, codigo) => modulosActivos(fincaId).includes(codigo);

export const requireModule = (codigo) => (req, _res, next) =>
  isModuleActive(req.user.fincaId, codigo) ? next() : next(forbidden(`El módulo ${codigo} está desactivado para esta finca`));
