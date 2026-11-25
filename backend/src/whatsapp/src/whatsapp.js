// Generado: 25/11/2026 06:15
// Conexión con WhatsApp mediante Baileys (API NO oficial: puede romperse y la cuenta puede ser restringida).
// Usa un número de PRUEBA. Una sola conexión y una sola instancia del proceso por cuenta.
import fs from 'node:fs';
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const aleatorio = (min, max) => Math.floor(min + Math.random() * Math.max(0, max - min));

/** "59170000000:12@s.whatsapp.net" -> "59170000000" */
export const telefonoDe = (jid) => String(jid ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');

/** Qué hacer cuando WhatsApp cierra la conexión (ver la guía, sección 3). */
export function accionDeCierre(code, creds = {}) {
  if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) return 'borrar';
  if (code === DisconnectReason.connectionReplaced) return 'reemplazada';
  if (code === DisconnectReason.restartRequired) return 'reiniciar'; // 515: NORMAL tras escanear el QR; hay que reconectar
  if (!creds.registered && !creds.me) return 'qr_vencido';
  return 'reintentar';
}

export function createWhatsApp({ config, logger, onMensaje, onEscribiendo }) {
  const w = config.wa;
  let sock = null;
  let iniciando = false;
  let reconectar = null;
  let intentos = 0;
  let qr = null;
  const vistos = new Set(); // ids ya procesados (deduplicación)
  const envios = []; // instantes de los últimos envíos (tope por minuto)
  const estado = { estado: 'inactivo', cuenta: null, error: null };

  async function conectar() {
    if (iniciando || sock) return estado;
    iniciando = true;
    clearTimeout(reconectar);
    estado.estado = intentos > 0 ? 'reconectando' : 'conectando';
    try {
      fs.mkdirSync(config.authDir, { recursive: true, mode: 0o700 });
      const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
      let version;
      try { ({ version } = await fetchLatestBaileysVersion()); } catch { logger.warn('No se pudo consultar la versión de WhatsApp Web'); }

      const s = makeWASocket({
        version,
        auth: state,
        logger: logger.child({ module: 'baileys' }, { level: 'warn' }),
        browser: Browsers.ubuntu('Bot'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        printQRInTerminal: false,
      });
      sock = s;

      s.ev.on('creds.update', saveCreds);
      s.ev.on('connection.update', (u) => alCambiarConexion(s, u, state));
      s.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const m of messages) procesar(m);
      });
      s.ev.on('presence.update', ({ id, presences }) => {
        if (Object.values(presences ?? {}).some((p) => p.lastKnownPresence === 'composing')) onEscribiendo?.(telefonoDe(id));
      });
    } catch (err) {
      sock = null;
      estado.error = `No se pudo iniciar: ${err.message}`;
      logger.error({ err: err.message }, 'Fallo al iniciar la conexión');
      programarReintento();
    } finally {
      iniciando = false;
    }
    return estado;
  }

  function alCambiarConexion(s, { connection, lastDisconnect, qr: nuevoQr }, authState) {
    if (s !== sock) return; // evento de un socket ya descartado
    if (nuevoQr) {
      qr = nuevoQr;
      estado.estado = 'qr';
      QRCode.toString(nuevoQr, { type: 'terminal', small: true }).then((t) => console.log(`\nEscanea este QR (WhatsApp > Dispositivos vinculados):\n${t}`));
    }
    if (connection === 'open') {
      intentos = 0; qr = null; estado.error = null;
      estado.estado = 'conectado';
      estado.cuenta = telefonoDe(s.user?.id);
      logger.info({ cuenta: `***${estado.cuenta.slice(-4)}` }, 'WhatsApp conectado');
      return;
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      descartar();
      qr = null; estado.cuenta = null;
      logger.warn({ code }, 'Conexión de WhatsApp cerrada');
      switch (accionDeCierre(code, authState.creds)) {
        case 'borrar':
          fs.rmSync(config.authDir, { recursive: true, force: true });
          estado.estado = 'desconectado'; estado.error = 'La sesión se cerró: hay que vincular de nuevo con un QR nuevo.';
          break;
        case 'reemplazada':
          estado.estado = 'desconectado'; estado.error = 'La cuenta se abrió en otro lugar. No se reintenta.';
          break;
        case 'reiniciar':
          setTimeout(conectar, 500); // vinculación exitosa: reconectar con las credenciales nuevas
          break;
        case 'qr_vencido':
          estado.estado = 'desconectado'; estado.error = 'El QR venció sin escanearse. Reinicia el servicio para generar otro.';
          break;
        default:
          programarReintento();
      }
    }
  }

  function programarReintento() {
    if (intentos >= w.maxReconnectAttempts) {
      estado.estado = 'fallido';
      estado.error = 'Se agotaron los reintentos de reconexión. Revisa el servidor y reinicia el servicio.';
      return;
    }
    intentos += 1;
    const espera = Math.min(60_000, 2000 * 2 ** (intentos - 1));
    estado.estado = 'reconectando';
    reconectar = setTimeout(conectar, espera);
  }

  function descartar() {
    try { sock?.ev.removeAllListeners(); sock?.end?.(undefined); } catch { /* ya cerrado */ }
    sock = null;
  }

  function procesar(m) {
    const jid = m.key?.remoteJid ?? '';
    if (m.key?.fromMe || !jid || jid === 'status@broadcast' || jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return;
    logger.info({ jid: jid.replace(/^\d+/, (d) => '***' + d.slice(-4)) }, 'Mensaje entrante');
    const id = m.key?.id;
    if (id) {
      if (vistos.has(id)) return;
      vistos.add(id);
      if (vistos.size > 2000) vistos.delete(vistos.values().next().value);
    }
    const msg = m.message ?? {};
    const texto = msg.conversation ?? msg.extendedTextMessage?.text ?? msg.imageMessage?.caption ?? null;
    const tipo = texto != null ? 'text' : (Object.keys(msg)[0] ?? 'otro').replace(/Message$/, '');
    onMensaje({ phone: telefonoDe(m.key?.remoteJidAlt || m.key?.senderPn || jid), jid, id, type: tipo, text: texto ?? `[${tipo}]`, timestamp: Number(m.messageTimestamp) || Math.floor(Date.now() / 1000) });
  }

  /** Envía texto con retraso aleatorio (parece humano) y tope de envíos por minuto. */
  async function enviar(jid, texto, { retraso = true } = {}) {
    if (!sock || estado.estado !== 'conectado') throw new Error('WhatsApp no está conectado');
    const ahora = Date.now();
    while (envios.length && ahora - envios[0] > 60_000) envios.shift();
    if (envios.length >= w.maxSendsPerMinute) throw new Error('Tope de envíos por minuto alcanzado');
    envios.push(ahora);
    if (retraso) {
      await sock.presenceSubscribe(jid).catch(() => {});
      await sock.sendPresenceUpdate('composing', jid).catch(() => {});
      await dormir(aleatorio(w.replyDelayMinMs, w.replyDelayMaxMs));
      await sock.sendPresenceUpdate('paused', jid).catch(() => {});
    }
    await sock.sendMessage(jid, { text: texto });
  }

  return {
    conectar,
    enviar,
    estado: () => ({ ...estado, intentos }),
    qrComoImagen: async () => (estado.estado === 'qr' && qr ? QRCode.toDataURL(qr, { margin: 1, width: 320 }) : null),
    cerrar() { clearTimeout(reconectar); descartar(); estado.estado = 'inactivo'; },
    /** Cierra la sesión en WhatsApp y borra las credenciales: hará falta un QR nuevo. */
    async desvincular() {
      clearTimeout(reconectar);
      try { await sock?.logout(); } catch { /* ya estaba cerrada */ }
      descartar();
      fs.rmSync(config.authDir, { recursive: true, force: true });
      qr = null; intentos = 0; estado.cuenta = null; estado.error = null; estado.estado = 'inactivo';
    },
  };
}
