/** Cliente HTTP único hacia la API REST. Maneja token JWT, errores normalizados y sesión expirada. */
export class ApiError extends Error {
  constructor(status, message, code, details) { super(message); this.status = status; this.code = code; this.details = details; }
  /** Errores de validación por campo: { campo: mensaje } */
  get fieldErrors() { return Array.isArray(this.details) ? Object.fromEntries(this.details.filter(d => d.campo).map(d => [d.campo, d.mensaje])) : {}; }
}

const cfg = {
  baseUrl: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || '/api',
  getToken: () => (typeof localStorage !== 'undefined' ? localStorage.getItem('crm_token') : null),
  onUnauthorized: () => {},
  fetch: (...a) => globalThis.fetch(...a),
};
export const configureHttp = (o) => Object.assign(cfg, o);

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') p.append(k, v);
  const s = p.toString(); return s ? `?${s}` : '';
}

async function request(method, path, { body, params, as = 'json', auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth ? cfg.getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try { res = await cfg.fetch(cfg.baseUrl + path + qs(params), { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch { throw new ApiError(0, 'Sin conexión con el servidor. Verifica tu red e inténtalo de nuevo.', 'NETWORK'); }
  if (!res.ok) {
    let e = {}; try { e = (await res.json()).error || {}; } catch { /* sin cuerpo */ }
    if (res.status === 401 && auth && !path.startsWith('/auth/login')) cfg.onUnauthorized(e.message);
    throw new ApiError(res.status, e.message || `Error ${res.status}`, e.code, e.details);
  }
  if (as === 'blob') return res.blob();
  const json = await res.json();
  return json;
}

export const api = {
  /** Devuelve data (y meta si existe en .meta) */
  async get(path, params) { const r = await request('GET', path, { params }); return r.meta ? Object.assign(r.data, { meta: r.meta }) : r.data; },
  /** Respuesta completa { data, meta } para listados paginados */
  list: (path, params) => request('GET', path, { params }),
  post: async (path, body, o) => (await request('POST', path, { body: body ?? {}, ...o })).data,
  put: async (path, body) => (await request('PUT', path, { body: body ?? {} })).data,
  patch: async (path, body) => (await request('PATCH', path, { body: body ?? {} })).data,
  del: async (path) => (await request('DELETE', path)).data,
  blob: (path, params) => request('GET', path, { params, as: 'blob' }),
  publicGet: async (path) => (await request('GET', path, { auth: false })).data,
};

/** Descarga un archivo autenticado (PDF/Excel/PNG) */
export async function downloadFile(path, params, filename) {
  const blob = await api.blob(path, params);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export async function openFile(path, params) {
  const blob = await api.blob(path, params);
  const url = URL.createObjectURL(blob); window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
