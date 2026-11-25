import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCatalog } from './catalog.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function runMigrations(db) {
  db.exec("CREATE TABLE IF NOT EXISTS _migraciones (nombre TEXT PRIMARY KEY, aplicada_at TEXT NOT NULL DEFAULT (datetime('now')))");
  const done = new Set(db.prepare('SELECT nombre FROM _migraciones').all().map(r => r.nombre));
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const applied = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _migraciones (nombre) VALUES (?)').run(f);
      db.exec('COMMIT');
      applied.push(f);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migración ${f} falló: ${e.message}`);
    }
  }
  ensureCatalog(db);
  return applied;
}

// Ejecución directa: npm run migrate
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { db } = await import('./index.js');
  console.log('Migraciones al día. Base de datos:', db.name);
}
