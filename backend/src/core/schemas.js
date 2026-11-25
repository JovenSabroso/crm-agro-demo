import { z } from 'zod';

// Sanitización: recorta, elimina etiquetas HTML y caracteres de control (defensa en profundidad contra XSS;
// el frontend además escapa toda salida).
const clean = (s) => s.replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();

export const str = (max = 200, min = 1) => z.string().transform(clean).pipe(z.string().min(min, 'Campo requerido').max(max, `Máximo ${max} caracteres`));
const emptyToNull = (v) => (v === '' ? null : v);
export const nullish = (schema) => z.preprocess(emptyToNull, schema.nullable().optional());

export const optStr = (max = 500) => nullish(str(max, 0));
const isRealDate = (v) => { const d = new Date(v + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };
export const date = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)').refine(isRealDate, 'Fecha inválida (no existe en el calendario)');
export const optDate = () => nullish(date());
export const num = (opts = {}) => {
  let s = z.coerce.number({ message: 'Debe ser un número' }).finite();
  if (opts.min !== undefined) s = s.min(opts.min, `Debe ser >= ${opts.min}`);
  if (opts.gt !== undefined) s = s.gt(opts.gt, `Debe ser > ${opts.gt}`);
  if (opts.max !== undefined) s = s.max(opts.max, `Debe ser <= ${opts.max}`);
  return s;
};
export const optNum = (opts = {}) => nullish(num(opts));
export const int = (opts = {}) => num(opts).pipe(z.number().int('Debe ser entero'));
export const optInt = (opts = {}) => nullish(int(opts));
export const id = () => z.coerce.number().int().positive();
export const optId = () => nullish(id());
export const bool = () => z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(v => (v ? 1 : 0));
export const enm = (vals) => z.enum(vals, { message: `Valor inválido. Opciones: ${vals.join(', ')}` });
export const email = () => z.string().trim().toLowerCase().email('Email inválido').max(120);
export const optEmail = () => nullish(email());
export const password = () => z.string().min(8, 'Mínimo 8 caracteres').max(100)
  .refine(v => /[A-Za-z]/.test(v) && /\d/.test(v), 'Debe incluir letras y números');

export const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  sort: z.string().trim().max(40).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  desde: z.string().optional(),
  hasta: z.string().optional(),
}).passthrough();
export { z };
