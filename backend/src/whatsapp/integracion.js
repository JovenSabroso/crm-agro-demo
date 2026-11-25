// Conecta el módulo WhatsApp + Gemini con CRM-Agro (login JWT, productos y pedidos de la BD).
import pino from 'pino';
import { crearModuloWhatsApp, loadConfig } from './src/index.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { db } from '../db/index.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Solo usuarios autenticados con permiso de ventas:write administran WhatsApp.
const autenticar = [authenticate, requirePerm('ventas:write')];

const fincaActiva = () => db.prepare('SELECT * FROM fincas WHERE activa = 1 ORDER BY id LIMIT 1').get();

async function negocio() {
  const f = fincaActiva();
  if (!f) return { nombre: 'CRM-Agro', catalogo: [], preguntas_frecuentes: [] };
  const catalogo = db.prepare(`SELECT nombre, precio_venta AS precio, unidad FROM productos
    WHERE finca_id = ? AND activo = 1 AND precio_venta IS NOT NULL ORDER BY nombre`).all(f.id)
    .map((p) => ({ nombre: p.nombre, precio: Number(p.precio), detalle: `por ${p.unidad}` }));
  return { nombre: f.nombre, horario: '', direccion: f.ubicacion || '', telefono: f.telefono || '', catalogo, preguntas_frecuentes: [] };
}

async function alCrearPedido({ phone, texto }) {
  const f = fincaActiva();
  if (!f) return;
  let c = db.prepare('SELECT id FROM clientes WHERE finca_id = ? AND telefono = ?').get(f.id, phone);
  if (!c) {
    const r = db.prepare('INSERT INTO clientes (finca_id, nombre, telefono, consentimiento_contacto, notas) VALUES (?,?,?,1,?)')
      .run(f.id, `WhatsApp ${phone}`, phone, 'Creado desde WhatsApp');
    c = { id: Number(r.lastInsertRowid) };
  }
  db.prepare(`INSERT INTO pedidos (finca_id, cliente_id, fecha, estado, observaciones) VALUES (?,?,date('now'),'pendiente',?)`)
    .run(f.id, c.id, `[WhatsApp] ${texto}`);
}

export function crearWhatsAppCrm() {
  return crearModuloWhatsApp({ config: loadConfig(), logger, autenticar, negocio, hooks: { alCrearPedido } });
}
