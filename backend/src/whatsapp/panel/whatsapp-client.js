// Generado: 25/11/2026 07:55
// Cliente JavaScript para usar la API del módulo desde CUALQUIER frontend (React, Vue, Angular, HTML...).
// Copia este archivo al frontend. No depende de ningún framework.
//
//   import { crearClienteWhatsApp } from './whatsapp-client.js';
//   const wa = crearClienteWhatsApp({ base: '/api/whatsapp', obtenerToken: () => miSesion.token });
//   const estado = await wa.estado();          // { whatsapp:{estado,cuenta,error}, habilitado, gemini, pendientes }
//   const { qr } = await wa.qr();              // data URL de la imagen del QR, o null
//
// `obtenerToken` devuelve lo que tu backend espere en "Authorization: Bearer ...":
//   - el JWT del usuario admin, si el backend montó el módulo con su propio middleware `autenticar`; o
//   - el ADMIN_TOKEN, si usa el del módulo.
// Si tu backend usa cookies de sesión en vez de Bearer, pasa `credenciales: 'include'` y `obtenerToken: () => ''`.

export function crearClienteWhatsApp({ base = '/api/whatsapp', obtenerToken = () => '', credenciales = 'same-origin', fetchImpl = fetch } = {}) {
  async function llamar(ruta, { metodo = 'GET', cuerpo } = {}) {
    const token = await obtenerToken();
    const res = await fetchImpl(`${base}${ruta}`, {
      method: metodo,
      credentials: credenciales,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(datos.error || `Error ${res.status}`), { status: res.status });
    return datos;
  }

  return {
    estado: () => llamar('/estado'),
    qr: () => llamar('/qr'),
    conectar: () => llamar('/conectar', { metodo: 'POST' }),
    desvincular: () => llamar('/desconectar', { metodo: 'POST' }),
    habilitar: (habilitado) => llamar('/habilitar', { metodo: 'POST', cuerpo: { habilitado } }),
    enviar: (to, text) => llamar('/enviar', { metodo: 'POST', cuerpo: { to, text } }),
    conversaciones: () => llamar('/conversaciones'),
    pausar: (phone, horas = 8) => llamar(`/conversaciones/${phone}/pausar`, { metodo: 'POST', cuerpo: { horas } }),
    reanudar: (phone) => llamar(`/conversaciones/${phone}/reanudar`, { metodo: 'POST' }),
    reactivar: (phone) => llamar(`/conversaciones/${phone}/alta`, { metodo: 'POST' }),

    /** Consulta el estado cada `cadaMs` y llama a `alCambiar({estado, qr})`. Devuelve una función para detenerlo. */
    vigilar(alCambiar, cadaMs = 4000) {
      let activo = true;
      const ciclo = async () => {
        if (!activo) return;
        try { const [e, q] = await Promise.all([this.estado(), this.qr()]); alCambiar({ estado: e, qr: q.qr }); }
        catch (error) { alCambiar({ error }); }
        if (activo) setTimeout(ciclo, cadaMs);
      };
      ciclo();
      return () => { activo = false; };
    },
  };
}
