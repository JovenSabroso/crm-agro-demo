<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Save, KeyRound, Power, Lock } from 'lucide-vue-next';
import PageHead from '../components/PageHead.vue';
import TabBar from '../components/TabBar.vue';
import CrudView from '../components/CrudView.vue';
import FormModal from '../components/FormModal.vue';
import { api } from '../api/http.js';
import { useAuth } from '../stores/auth.js';
import { useUi } from '../stores/ui.js';
import { fmtDate } from '../utils/format.js';

const auth = useAuth(); const ui = useUi(); const route = useRoute();
const tabs = [{ key: 'finca', label: 'Finca y configuración' }, { key: 'usuarios', label: 'Usuarios y roles', perm: 'usuarios:admin' }, { key: 'modulos', label: 'Módulos' }, { key: 'roles', label: 'Roles y permisos', perm: 'usuarios:admin' }];
const visibleTabs = computed(() => tabs.filter(t => auth.can(t.perm)));
const tab = ref(visibleTabs.value.find(t => t.key === route.query.tab)?.key || 'finca');

// ----- Finca -----
const finca = reactive({}); const savingF = ref(false); const canEditFinca = computed(() => auth.can('finca:admin'));
async function loadFinca() { Object.assign(finca, await api.get('/finca')); }
async function saveFinca() {
  savingF.value = true;
  try {
    const { nombre, ubicacion, latitud, longitud, superficie_ha, moneda, telefono, descripcion } = finca;
    Object.assign(finca, await api.put('/finca', { nombre, ubicacion, latitud: latitud === '' ? null : latitud, longitud: longitud === '' ? null : longitud, superficie_ha: superficie_ha === '' ? null : superficie_ha, moneda, telefono, descripcion }));
    await auth.refreshModules(); ui.success('Datos de la finca actualizados');
  } catch (e) { ui.error(e); } finally { savingF.value = false; }
}

// ----- Módulos -----
const modulos = ref([]); const canMod = computed(() => auth.can('modulos:admin'));
async function loadModulos() { modulos.value = await api.get('/modulos'); }
async function toggleModulo(m) {
  if (!canMod.value || m.obligatorio) return;
  const nuevo = !m.activo;
  if (!nuevo && !(await ui.confirm({ title: `Desactivar ${m.nombre}`, message: 'Los datos se conservan, pero la sección dejará de estar disponible para todos los usuarios de la finca.', confirmText: 'Desactivar', danger: true }))) return;
  try { await api.put(`/modulos/${m.codigo}`, { activo: nuevo }); await Promise.all([loadModulos(), auth.refreshModules()]); ui.success(`${m.nombre} ${nuevo ? 'activado' : 'desactivado'}`); } catch (e) { ui.error(e); }
}

// ----- Usuarios -----
const ROLES = [{ value: 'propietario', label: 'Propietario' }, { value: 'encargado', label: 'Encargado' }, { value: 'trabajador', label: 'Trabajador' }];
const userCols = [{ key: 'nombre', label: 'Nombre', sortable: true }, { key: 'email', label: 'Email' }, { key: 'rol_nombre', label: 'Rol' }, { key: 'activo', label: 'Estado', format: r => (r.activo ? 'Activo' : 'Inactivo') }, { key: 'ultimo_login', label: 'Último acceso', type: 'date' }];
const userFields = [
  { key: 'nombre', label: 'Nombre completo', required: true }, { key: 'email', label: 'Email', type: 'email', requiredOnCreate: true, lockOnEdit: true },
  { key: 'password', label: 'Contraseña inicial', type: 'password', requiredOnCreate: true, checkStrength: true, skipEmpty: true, hint: 'Solo al crear. Mínimo 8 caracteres con letras y números.', showIf: () => true },
  { key: 'rol', label: 'Rol', type: 'select', options: ROLES, required: true, default: 'trabajador' }, { key: 'activo', label: 'Usuario activo', type: 'checkbox', default: true },
];
const users = ref(null);
const userActions = [
  { label: 'Contraseña', icon: KeyRound, run: (row) => { pwdUser.value = row; } },
];
const pwdUser = ref(null);
async function resetPwd(p) { await api.post(`/usuarios/${pwdUser.value.id}/password`, p); ui.success('Contraseña restablecida; las sesiones del usuario se cerraron.'); }

// ----- Roles -----
const roles = ref([]);
async function loadRoles() { roles.value = await api.get('/roles'); }
onMounted(() => { loadFinca(); loadModulos(); if (auth.can('usuarios:admin')) loadRoles(); });
</script>

<template>
  <PageHead title="Núcleo y fincas" subtitle="Datos generales, usuarios, roles y módulos activos de la finca." />
  <TabBar v-model="tab" :tabs="visibleTabs" />

  <div v-if="tab === 'finca'" class="card card-pad">
    <div v-if="!canEditFinca" class="callout info" style="margin-bottom:14px"><Lock :size="15" style="vertical-align:-3px" /> Solo el propietario puede modificar estos datos.</div>
    <form class="form-grid" @submit.prevent="saveFinca">
      <div class="field"><label>Nombre de la finca *</label><input class="input" v-model="finca.nombre" :disabled="!canEditFinca" required /></div>
      <div class="field"><label>Ubicación</label><input class="input" v-model="finca.ubicacion" :disabled="!canEditFinca" /></div>
      <div class="field"><label>Superficie total (ha)</label><input class="input" type="number" step="any" min="0" v-model="finca.superficie_ha" :disabled="!canEditFinca" /></div>
      <div class="field"><label>Moneda</label><input class="input" v-model="finca.moneda" maxlength="5" :disabled="!canEditFinca" /></div>
      <div class="field"><label>Latitud</label><input class="input" type="number" step="any" v-model="finca.latitud" :disabled="!canEditFinca" /></div>
      <div class="field"><label>Longitud</label><input class="input" type="number" step="any" v-model="finca.longitud" :disabled="!canEditFinca" /></div>
      <div class="field"><label>Teléfono</label><input class="input" v-model="finca.telefono" :disabled="!canEditFinca" /></div>
      <div class="field full"><label>Descripción</label><textarea class="input" v-model="finca.descripcion" :disabled="!canEditFinca" /></div>
      <div v-if="canEditFinca" class="full"><button class="btn primary" :disabled="savingF"><span v-if="savingF" class="spinner" /><Save :size="16" />Guardar cambios</button></div>
    </form>
  </div>

  <template v-if="tab === 'usuarios'">
    <CrudView ref="users" endpoint="/usuarios" noun="usuario" write-perm="usuarios:admin" :columns="userCols" :fields="userFields" :deletable="false" :row-actions="userActions" default-sort="nombre" default-dir="asc"
      :filters="[{ key: 'rol', label: 'Rol', options: ROLES }]" hint="Los usuarios no se eliminan: se desactivan para conservar el historial y la auditoría." />
    <FormModal v-if="pwdUser" :title="`Restablecer contraseña · ${pwdUser.nombre}`" :fields="[{ key: 'password', label: 'Nueva contraseña', type: 'password', required: true, checkStrength: true }]" submit-text="Restablecer" :on-submit="resetPwd" @close="pwdUser = null" />
  </template>

  <div v-if="tab === 'modulos'" class="stack">
    <div class="callout info">La finca empieza con los módulos esenciales y escala gradualmente. Un módulo desactivado se oculta del menú y su API queda bloqueada; los datos se conservan.</div>
    <div class="grid g3">
      <div v-for="m in modulos" :key="m.codigo" class="card card-pad stack" style="gap:8px">
        <div class="row between"><span class="badge" :class="m.activo ? 'ok' : ''">{{ m.codigo }}</span><span v-if="m.obligatorio" class="badge info">Obligatorio</span></div>
        <h3>{{ m.nombre }}</h3><p class="muted small" style="margin:0">{{ m.descripcion }}</p>
        <button class="btn" :class="m.activo ? '' : 'primary'" :disabled="!canMod || m.obligatorio" @click="toggleModulo(m)"><Power :size="16" />{{ m.activo ? 'Desactivar' : 'Activar' }}</button>
      </div>
    </div>
  </div>

  <div v-if="tab === 'roles'" class="grid g3">
    <div v-for="r in roles" :key="r.id" class="card card-pad stack" style="gap:8px"><h3>{{ r.nombre }}</h3><span class="muted small">{{ r.permisos.length }} permisos</span>
      <ul class="list small"><li v-for="p in r.permisos" :key="p.codigo" style="padding:5px 0"><code>{{ p.codigo }}</code><span class="muted">{{ p.descripcion }}</span></li></ul></div>
  </div>
</template>
