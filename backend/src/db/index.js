import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config/env.js';
import { runMigrations } from './migrate.js';

export function openDatabase(file = config.dbPath) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');
  d.pragma('busy_timeout = 5000');
  runMigrations(d);
  return d;
}
export const db = openDatabase();

// Ejecuta fn dentro de una transacción (anidable: reutiliza la actual).
export function tx(fn) {
  return db.inTransaction ? fn() : db.transaction(fn)();
}
