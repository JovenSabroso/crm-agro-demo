import { ZodError } from 'zod';
import { AppError } from '../core/errors.js';
import { config } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Ruta no encontrada: ${req.method} ${req.originalUrl}` } });
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Datos inválidos', details: err.issues.map(i => ({ campo: i.path.join('.'), mensaje: i.message })) } });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
  }
  // Errores de SQLite: se traducen sin filtrar detalles internos.
  const code = err?.code || '';
  if (code.startsWith('SQLITE_CONSTRAINT')) {
    const msg = String(err.message);
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'Ya existe un registro con esos datos (valor duplicado)' } });
    if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(409).json({ error: { code: 'REFERENCED', message: 'La operación viola una relación: el registro está en uso o referencia un dato inexistente' } });
    if (code === 'SQLITE_CONSTRAINT_CHECK') return res.status(422).json({ error: { code: 'BUSINESS_RULE', message: msg.includes('stock_actual') || msg.includes('stock_resultante') ? 'Stock insuficiente' : 'Un valor no cumple las reglas de integridad' } });
    return res.status(409).json({ error: { code: 'CONSTRAINT', message: 'Restricción de datos incumplida' } });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'JSON inválido' } });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Solicitud demasiado grande' } });
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno del servidor', ...(config.isProd ? {} : { debug: String(err?.message) }) } });
}
