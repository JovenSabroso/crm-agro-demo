import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, configureHttp } from '../api/http.js';

const storage = () => (typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem() {}, removeItem() {} });

export const useAuth = defineStore('auth', () => {
  const token = ref(storage().getItem('crm_token'));
  const usuario = ref(null); const finca = ref(null);
  const permisos = ref([]); const modulos = ref([]);
  const ready = ref(false);

  const isAuthenticated = computed(() => !!token.value && !!usuario.value);
  /** Verificación de permisos en el frontend (el backend los vuelve a validar siempre). */
  const can = (perm) => !perm || permisos.value.includes(perm);
  const canAny = (list) => !list?.length || list.some(can);
  const hasModule = (m) => !m || modulos.value.includes(m);
  const moneda = computed(() => (finca.value?.moneda === 'BOB' || !finca.value?.moneda ? 'Bs' : finca.value.moneda));

  function setSession(data) {
    if (data.token) { token.value = data.token; storage().setItem('crm_token', data.token); }
    usuario.value = data.usuario; finca.value = data.finca; permisos.value = data.permisos; modulos.value = data.modulos; ready.value = true;
  }
  function clear() { token.value = null; usuario.value = null; finca.value = null; permisos.value = []; modulos.value = []; storage().removeItem('crm_token'); ready.value = true; }

  async function login(email, password) { setSession(await api.post('/auth/login', { email, password }, { auth: false })); }
  async function registro(payload) { setSession(await api.post('/auth/registro', payload, { auth: false })); }
  async function logout() { try { if (token.value) await api.post('/auth/logout'); } catch { /* la sesión local se limpia igual */ } clear(); }
  async function loadMe() {
    if (!token.value) { ready.value = true; return false; }
    try { setSession(await api.get('/auth/me')); return true; } catch { clear(); return false; }
  }
  async function refreshModules() { setSession(await api.get('/auth/me')); }

  configureHttp({ getToken: () => token.value, onUnauthorized: () => { if (token.value) clear(); if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/t/')) window.location.assign('/login?expirada=1'); } });
  return { token, usuario, finca, permisos, modulos, ready, isAuthenticated, moneda, can, canAny, hasModule, login, registro, logout, loadMe, refreshModules, setSession, clear };
});
