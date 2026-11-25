import { db } from '../db/index.js';
import { Page } from './api.js';
import { listQuery } from './schemas.js';
import { notFound, badRequest, conflict } from './errors.js';
import { audit } from './audit.js';

/** Verifica que `id` exista en `table` y pertenezca a la finca (aislamiento multi-finca). */
export function assertOwned(table, id, fincaId, label = table) {
  if (id == null) return null;
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND finca_id = ?`).get(id, fincaId);
  if (!row) throw badRequest(`${label}: el registro ${id} no existe en esta finca`);
  return row;
}

const toDb = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v);

/**
 * Fábrica CRUD con búsqueda, filtros, ordenamiento, paginación y aislamiento por finca.
 * cfg: { name, table, perm, create, update?, search[], filters{}, sorts{}, defaultSort, dateField,
 *        select?, joins?, owned{campo:tabla}, before?(data,req,existing), after?(row,req), noDelete }
 */
export function crud(api, cfg) {
  const A = 'x';
  const sorts = { id: `${A}.id`, ...(cfg.sorts || {}) };
  const baseFrom = `${cfg.table} ${A} ${cfg.joins || ''}`;
  const sel = `${A}.*${cfg.select ? ', ' + cfg.select : ''}`;
  const updateSchema = cfg.update || cfg.create?.partial();

  const getOne = (id, fincaId) => db.prepare(`SELECT ${sel} FROM ${baseFrom} WHERE ${A}.id = ? AND ${A}.finca_id = ?`).get(id, fincaId);
  const checkOwned = (data, fincaId) => {
    for (const [field, table] of Object.entries(cfg.owned || {})) if (data[field] != null) assertOwned(table, data[field], fincaId, field);
  };

  api.get('/', { summary: `Listar ${cfg.name}`, perm: `${cfg.perm}:read`, query: listQuery }, (req) => {
    const q = req.q; const where = [`${A}.finca_id = ?`]; const args = [req.user.fincaId];
    if (q.q && cfg.search?.length) { where.push('(' + cfg.search.map(c => `${c} LIKE ? ESCAPE '\\'`).join(' OR ') + ')'); const like = `%${q.q.replace(/[\\%_]/g, m => '\\' + m)}%`; cfg.search.forEach(() => args.push(like)); }
    for (const [key, col] of Object.entries(cfg.filters || {})) if (q[key] !== undefined && q[key] !== '') { where.push(`${col} = ?`); args.push(q[key]); }
    for (const [key, sql] of Object.entries(cfg.flags || {})) if (q[key] === '1' || q[key] === 'true') where.push(`(${sql})`);
    if (cfg.dateField) { if (q.desde) { where.push(`${cfg.dateField} >= ?`); args.push(q.desde); } if (q.hasta) { where.push(`${cfg.dateField} <= ?`); args.push(q.hasta); } }
    const orderCol = sorts[q.sort] || sorts[cfg.defaultSort?.split(' ')[0]] || `${A}.id`;
    const dir = q.dir ? q.dir.toUpperCase() : (cfg.defaultSort?.split(' ')[1] || 'DESC').toUpperCase();
    const W = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) c FROM ${baseFrom} WHERE ${W}`).get(...args).c;
    const rows = db.prepare(`SELECT ${sel} FROM ${baseFrom} WHERE ${W} ORDER BY ${orderCol} ${dir}, ${A}.id DESC LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize);
    return new Page(rows, { page: q.page, pageSize: q.pageSize, total });
  });

  api.get('/:id', { summary: `Obtener ${cfg.name}`, perm: `${cfg.perm}:read` }, (req) => {
    const row = getOne(Number(req.params.id), req.user.fincaId);
    if (!row) throw notFound(`${cfg.name}: no encontrado`);
    return row;
  });

  const has = (m) => !(cfg.skip || []).includes(m);
  if (has('post')) api.post('/', { summary: `Crear ${cfg.name}`, perm: `${cfg.perm}:write`, body: cfg.create }, (req) => {
    let data = { ...req.body };
    checkOwned(data, req.user.fincaId);
    if (cfg.before) data = cfg.before(data, req, null) || data;
    const keys = Object.keys(data).filter(k => data[k] !== undefined);
    const info = db.prepare(`INSERT INTO ${cfg.table} (finca_id, ${keys.join(',')}) VALUES (?, ${keys.map(() => '?').join(',')})`)
      .run(req.user.fincaId, ...keys.map(k => toDb(data[k])));
    const row = getOne(info.lastInsertRowid, req.user.fincaId);
    audit(req, { accion: 'crear', entidad: cfg.table, id: row.id, detalle: data });
    if (cfg.after) cfg.after(row, req, 'create');
    return row;
  });

  if (has('put')) api.put('/:id', { summary: `Actualizar ${cfg.name}`, perm: `${cfg.perm}:write`, body: updateSchema }, (req) => {
    const id = Number(req.params.id);
    const existing = getOne(id, req.user.fincaId);
    if (!existing) throw notFound(`${cfg.name}: no encontrado`);
    let data = { ...req.body };
    checkOwned(data, req.user.fincaId);
    if (cfg.before) data = cfg.before(data, req, existing) || data;
    const keys = Object.keys(data).filter(k => data[k] !== undefined);
    if (keys.length) db.prepare(`UPDATE ${cfg.table} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ? AND finca_id = ?`).run(...keys.map(k => toDb(data[k])), id, req.user.fincaId);
    const row = getOne(id, req.user.fincaId);
    audit(req, { accion: 'actualizar', entidad: cfg.table, id, detalle: data });
    if (cfg.after) cfg.after(row, req, 'update');
    return row;
  });

  if (!cfg.noDelete && has('delete')) {
    api.delete('/:id', { summary: `Eliminar ${cfg.name}`, perm: `${cfg.perm}:write` }, (req) => {
      const id = Number(req.params.id);
      const existing = getOne(id, req.user.fincaId);
      if (!existing) throw notFound(`${cfg.name}: no encontrado`);
      if (cfg.beforeDelete) cfg.beforeDelete(existing, req);
      try { db.prepare(`DELETE FROM ${cfg.table} WHERE id = ? AND finca_id = ?`).run(id, req.user.fincaId); }
      catch (e) { if (String(e.code).startsWith('SQLITE_CONSTRAINT')) throw conflict(`No se puede eliminar: ${cfg.name} tiene registros relacionados`); throw e; }
      audit(req, { accion: 'eliminar', entidad: cfg.table, id, detalle: { nombre: existing.nombre ?? existing.codigo ?? null } });
      return { id, eliminado: true };
    });
  }
  return { getOne };
}
