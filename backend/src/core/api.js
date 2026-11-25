import express from 'express';
import { z } from 'zod';
import { authenticate, requirePerm, requireModule } from '../middleware/auth.js';
import { badRequest } from './errors.js';

/** Registro global de endpoints → genera automáticamente la documentación OpenAPI/Swagger. */
export const registry = [];

export class Page {
  constructor(rows, { page, pageSize, total }) { this.rows = rows; this.meta = { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }; }
}

/**
 * Crea un grupo de rutas.
 * opts de cada ruta: { summary, perm, body, query, public, module, status, raw }
 */
export function createApi(tag, { prefix, module: mod } = {}) {
  const router = express.Router();
  const api = { router, tag, prefix };

  router.param('id', (req, _res, next, v) => (/^\d+$/.test(v) ? next() : next(badRequest('El id debe ser numérico'))));

  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    api[method] = (path, opts, handler) => {
      const chain = [...(opts.use || [])];
      if (!opts.public) chain.push(authenticate);
      const m = opts.module === undefined ? mod : opts.module;
      if (m && !opts.public) chain.push(requireModule(m));
      if (opts.perm) chain.push(requirePerm(opts.perm));
      chain.push((req, _res, next) => {
        try {
          if (opts.body) req.body = opts.body.parse(req.body ?? {});
          req.q = opts.query ? opts.query.parse(req.query) : { ...req.query };
          next();
        } catch (e) { next(e); }
      });
      router[method](path, ...chain, async (req, res) => {
        const result = await handler(req, res);
        if (res.headersSent || opts.raw) return;
        const status = opts.status ?? (method === 'post' ? 201 : 200);
        if (result instanceof Page) return res.status(status).json({ data: result.rows, meta: result.meta });
        res.status(status).json({ data: result ?? null });
      });
      registry.push({ method, path: (prefix || '') + path, tag, ...opts, module: m });
      return api;
    };
  }
  return api;
}

// ---------- OpenAPI ----------
const jsonSchema = (s) => {
  try { const j = z.toJSONSchema(s, { unrepresentable: 'any', io: 'input', target: 'draft-7' }); delete j.$schema; return j; }
  catch { return { type: 'object' }; }
};

export function buildOpenApi() {
  const paths = {};
  for (const r of registry) {
    const p = r.path.replace(/:(\w+)/g, '{$1}');
    paths[p] ??= {};
    const params = [...(r.path.matchAll(/:(\w+)/g))].map(m => ({ name: m[1], in: 'path', required: true, schema: { type: 'integer' } }));
    if (r.query) {
      const js = jsonSchema(r.query);
      for (const [name, sch] of Object.entries(js.properties || {})) params.push({ name, in: 'query', required: (js.required || []).includes(name), schema: sch });
    }
    const op = {
      tags: [r.tag],
      summary: r.summary || `${r.method.toUpperCase()} ${p}`,
      description: [r.perm ? `Permiso requerido: \`${r.perm}\`.` : null, r.module ? `Módulo requerido: **${r.module}**.` : null, r.public ? 'Endpoint público.' : null].filter(Boolean).join(' '),
      parameters: params,
      responses: {
        200: { description: 'OK. Formato: { data, meta? }' },
        400: { description: 'Validación fallida' }, 401: { description: 'No autenticado' },
        403: { description: 'Sin permiso / módulo desactivado' }, 404: { description: 'No encontrado' },
        409: { description: 'Conflicto / duplicado' }, 422: { description: 'Regla de negocio incumplida' },
      },
    };
    if (!r.public) op.security = [{ bearerAuth: [] }];
    if (r.body) op.requestBody = { required: true, content: { 'application/json': { schema: jsonSchema(r.body) } } };
    paths[p][r.method] = op;
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'CRM-Agro API',
      version: '1.0.0',
      description: 'API REST de CRM-Agro — gestión modular agrícola (UNIFRANZ, El Alto). Respuestas: `{ data, meta? }`; errores: `{ error: { code, message, details? } }`.',
    },
    servers: [{ url: '/api' }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    paths: Object.fromEntries(Object.entries(paths).map(([k, v]) => [k, v])),
  };
}
