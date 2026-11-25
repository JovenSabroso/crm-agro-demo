<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageHead from '../components/PageHead.vue';
import TabBar from '../components/TabBar.vue';
import DataTable from '../components/DataTable.vue';
import { api } from '../api/http.js';
import { useAuth } from '../stores/auth.js';
import { useUi } from '../stores/ui.js';
import { fmtDate } from '../utils/format.js';

const route = useRoute(); const router = useRouter(); const auth = useAuth(); const ui = useUi();
const tabs = computed(() => [{ key: 'perfil', label: 'Mi perfil' }, { key: 'password', label: 'Contraseña' }, ...(auth.can('auditoria:read') ? [{ key: 'auditoria', label: 'Auditoría' }] : []), ...(auth.can('finca:admin') ? [{ key: 'integraciones', label: 'Integraciones' }] : [])]);
const tab = ref(tabs.value.find(t => t.key === route.query.tab)?.key || 'perfil');
const p = reactive({ actual: '', nueva: '', repetir: '' }); const saving = ref(false);
async function cambiar() {
  if (p.nueva !== p.repetir) return ui.error({ message: 'Las contraseñas nuevas no coinciden.' });
  saving.value = true;
  try { const r = await api.post('/auth/cambiar-password', { actual: p.actual, nueva: p.nueva }); auth.setSession({ ...auth.$state, token: r.token, usuario: auth.usuario, finca: auth.finca, permisos: auth.permisos, modulos: auth.modulos }); localStorage.setItem('crm_token', r.token); ui.success('Contraseña actualizada'); Object.assign(p, { actual: '', nueva: '', repetir: '' }); }
  catch (e) { ui.error(e); } finally { saving.value = false; }
}
async function salir() { await auth.logout(); router.replace('/login'); }
const aud = ref([]); const audMeta = ref(null); const page = ref(1);
async function loadAud() { const r = await api.list('/auditoria', { page: page.value, pageSize: 20 }); aud.value = r.data; audMeta.value = r.meta; }
const integ = ref(null);
onMounted(async () => { try { if (auth.can('auditoria:read')) await loadAud(); if (auth.can('finca:admin')) integ.value = await api.get('/integraciones/estado'); } catch (e) { ui.error(e); } });
const audCols = [{ key: 'created_at', label: 'Fecha', format: r => r.created_at }, { key: 'usuario', label: 'Usuario' }, { key: 'accion', label: 'Acción' }, { key: 'entidad', label: 'Entidad' }, { key: 'entidad_id', label: 'Id' }];
</script>

<template>
  <PageHead title="Configuración" subtitle="Tu perfil, seguridad y estado de las integraciones." />
  <TabBar v-model="tab" :tabs="tabs" />
  <div v-if="tab === 'perfil'" class="card card-pad stack" style="max-width:640px"><dl class="kv"><dt>Nombre</dt><dd>{{ auth.usuario.nombre }}</dd><dt>Email</dt><dd>{{ auth.usuario.email }}</dd><dt>Rol</dt><dd><span class="badge ok">{{ auth.usuario.rol_nombre || auth.usuario.rol }}</span></dd><dt>Finca</dt><dd>{{ auth.finca.nombre }}</dd><dt>Módulos activos</dt><dd>{{ auth.modulos.join(', ') }}</dd><dt>Permisos</dt><dd class="small">{{ auth.permisos.join(' · ') }}</dd></dl>
    <div><button class="btn danger" @click="salir">Cerrar sesión</button></div></div>
  <form v-if="tab === 'password'" class="card card-pad stack" style="max-width:480px" @submit.prevent="cambiar"><div class="field"><label>Contraseña actual</label><input class="input" type="password" v-model="p.actual" autocomplete="current-password" required /></div>
    <div class="field"><label>Nueva contraseña</label><input class="input" type="password" v-model="p.nueva" autocomplete="new-password" required /><span class="hint">Mínimo 8 caracteres, con letras y números.</span></div><div class="field"><label>Repetir nueva contraseña</label><input class="input" type="password" v-model="p.repetir" autocomplete="new-password" required /></div>
    <button class="btn primary" :disabled="saving"><span v-if="saving" class="spinner" />Cambiar contraseña</button></form>
  <div v-if="tab === 'auditoria'" class="card"><DataTable :columns="audCols" :rows="aud" :meta="audMeta" @page="p => { page = p; loadAud(); }" /></div>
  <div v-if="tab === 'integraciones' && integ" class="stack"><div class="callout">Estas integraciones <b>no están conectadas</b>. La arquitectura (adaptadores, webhooks desactivados, cola de confirmación) está lista; ver README → "Preparación para WhatsApp / IA".</div>
    <div class="grid g3"><div class="card card-pad stack"><h3>WhatsApp</h3><span class="badge warn">Pendiente de integración</span><span class="small muted">Proveedor previsto: {{ integ.whatsapp.proveedor }}. Webhook reservado: {{ integ.whatsapp.webhook }} (responde 503).</span></div>
      <div class="card card-pad stack"><h3>Agente de IA</h3><span class="badge warn">Pendiente de integración</span><span class="small muted">Proveedor previsto: {{ integ.ia.proveedor }}. Sin respuestas simuladas.</span></div>
      <div class="card card-pad stack"><h3>Despliegue y dominio</h3><span class="badge warn">Pendiente</span><span class="small muted">{{ integ.despliegue.detalle }}</span></div></div></div>
</template>
