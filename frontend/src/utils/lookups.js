import { reactive } from 'vue';
import { api } from '../api/http.js';

/** Caché de listas de opciones (lotes, clientes, productos…) obtenidas de la API. */
const cache = reactive({});
const inflight = {};

export async function loadLookup(endpoint, { params = {}, value = 'id', label = (r) => r.nombre, force = false } = {}) {
  const key = endpoint + JSON.stringify(params);
  if (!force && cache[key]) return cache[key];
  if (!force && inflight[key]) return inflight[key];
  inflight[key] = api.get(endpoint, { pageSize: 200, ...params }).then((rows) => {
    cache[key] = rows.map(r => ({ value: r[value], label: label(r), raw: r }));
    delete inflight[key]; return cache[key];
  }).catch((e) => { delete inflight[key]; throw e; });
  return inflight[key];
}
export const clearLookups = () => { for (const k of Object.keys(cache)) delete cache[k]; };

/** Definiciones de lookups habituales */
export const LK = {
  lotes: { endpoint: '/lotes', label: r => `${r.codigo} · ${r.nombre}` },
  cultivos: { endpoint: '/cultivos', label: r => r.variedad ? `${r.nombre} ${r.variedad}` : r.nombre },
  campanas: { endpoint: '/campanas', label: r => r.nombre },
  trabajadores: { endpoint: '/trabajadores', params: { estado: 'activo' }, label: r => r.nombre },
  trabajadoresTodos: { endpoint: '/trabajadores', label: r => r.nombre },
  proveedores: { endpoint: '/proveedores', label: r => r.nombre },
  productos: { endpoint: '/productos', params: { activo: 1 }, label: r => `${r.nombre} (${r.unidad})` },
  agroquimicos: { endpoint: '/productos', params: { categoria: 'agroquimicos', activo: 1 }, label: r => `${r.nombre} (${r.unidad})` },
  clientes: { endpoint: '/clientes', label: r => r.nombre },
  viveros: { endpoint: '/viveros', label: r => r.nombre },
  especies: { endpoint: '/especies', label: r => r.variedad ? `${r.nombre} ${r.variedad}` : r.nombre },
  siembras: { endpoint: '/vivero/siembras', label: r => `${r.codigo} · ${r.especie_nombre}` },
};
