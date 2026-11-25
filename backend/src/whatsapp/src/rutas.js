// Generado: 25/11/2026 07:40
// API REST del módulo, para cualquier frontend (React, Vue, HTML...). Se monta en la ruta que quieras:
//   app.use('/api/whatsapp', modulo.router)
// Autenticación: si pasas `autenticar` (tu middleware de login/JWT/roles), se usa ese. Si no, Bearer ADMIN_TOKEN.
// Solo GET /panel es público (es una página estática que pide el token); todo lo demás exige autenticación.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PANEL = path.join(AQUI, '..', 'panel', 'whatsapp.html');
const TELEFONO = /^\d{8,15}$/;

function iguales(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); // tiempo constante
}

export function crearRouter({ modulo, config, autenticar }) {
  const router = express.Router();
  router.use(express.json({ limit: '10kb' }));

  const porToken = (req, res, next) => {
    const dado = req.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (iguales(dado, config.adminToken)) return next();
    res.status(401).json({ error: 'No autorizado' });
  };
  const auth = autenticar ?? porToken;

  // Página de administración lista para usar (independiente del frontend de tu compañero).
  router.get('/panel', (_req, res) => {
    res.set('Cache-Control', 'no-store').type('html').send(fs.readFileSync(PANEL, 'utf8'));
  });

  router.get('/estado', auth, (_req, res) => res.json(modulo.estado()));

  /** QR actual como imagen (data URL) o null. El frontend lo consulta cada pocos segundos. */
  router.get('/qr', auth, async (_req, res) => {
    res.json({ estado: modulo.wa.estado().estado, qr: await modulo.wa.qrComoImagen() });
  });

  router.post('/conectar', auth, async (_req, res) => res.json(await modulo.wa.conectar()));

  router.post('/desconectar', auth, async (_req, res) => {
    await modulo.wa.desvincular();
    res.json(modulo.estado());
  });

  router.post('/habilitar', auth, (req, res) => {
    if (typeof req.body?.habilitado !== 'boolean') return res.status(422).json({ error: 'habilitado debe ser true o false' });
    res.json(modulo.habilitar(req.body.habilitado));
  });

  /** Envía un mensaje a un cliente. Body: { to: "59170000000", text: "...", delay?: false } */
  router.post('/enviar', auth, async (req, res) => {
    const { to, text, delay } = req.body ?? {};
    if (!TELEFONO.test(String(to ?? ''))) return res.status(422).json({ error: 'to debe tener entre 8 y 15 dígitos (con código de país)' });
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) return res.status(422).json({ error: 'text es obligatorio (máximo 1000 caracteres)' });
    try {
      await modulo.enviar(String(to), text, { retraso: delay !== false });
      res.json({ ok: true });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });

  router.get('/conversaciones', auth, (_req, res) => {
    const { bajas, pausas } = modulo.store.data;
    res.json({ bajas, pausas: Object.keys(pausas).filter((p) => modulo.store.estaPausado(p)) });
  });

  const telefono = (req, res) => {
    if (!TELEFONO.test(req.params.phone)) { res.status(422).json({ error: 'Teléfono no válido' }); return null; }
    return req.params.phone;
  };
  router.post('/conversaciones/:phone/pausar', auth, (req, res) => {
    const phone = telefono(req, res); if (!phone) return;
    const horas = Math.min(Math.max(Number(req.body?.horas) || 8, 0.1), 168);
    modulo.store.pausar(phone, horas);
    res.json({ ok: true, horas });
  });
  router.post('/conversaciones/:phone/reanudar', auth, (req, res) => {
    const phone = telefono(req, res); if (!phone) return;
    modulo.store.reanudar(phone);
    res.json({ ok: true });
  });
  router.post('/conversaciones/:phone/alta', auth, (req, res) => {
    const phone = telefono(req, res); if (!phone) return;
    modulo.store.reactivar(phone);
    res.json({ ok: true });
  });

  return router;
}
