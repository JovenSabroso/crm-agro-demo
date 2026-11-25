<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { LayoutDashboard, Building2, Sprout, Tractor, Users, Boxes, Flower2, ChartNoAxesCombined, Settings, Menu, Bell, Plus, LogOut, KeyRound, UserRound, ShoppingCart, Wheat, ClipboardCheck, Droplets, QrCode, Lock } from 'lucide-vue-next';
import { MENU } from '../router/index.js';
import { useAuth } from '../stores/auth.js';
import { useUi } from '../stores/ui.js';
import { api } from '../api/http.js';
import { initials, fmtDate } from '../utils/format.js';

const Icons = { LayoutDashboard, Building2, Sprout, Tractor, QrCode, Users, Boxes, ShoppingCart, Flower2, ChartNoAxesCombined, Settings };
const auth = useAuth(); const ui = useUi(); const router = useRouter(); const route = useRoute();
const alertas = ref([]); const openMenu = ref(null);
const items = computed(() => MENU.filter(m => auth.can(m.perm) || m.name === 'dashboard' || m.name === 'configuracion').map(m => ({ ...m, off: !!m.module && !auth.hasModule(m.module) })));
const quick = computed(() => [
  { label: 'Nueva venta', icon: ShoppingCart, to: '/ventas?nueva=1', ok: auth.can('ventas:write') && auth.hasModule('M5') },
  { label: 'Registrar cosecha', icon: Wheat, to: '/campo?tab=cosechas&nueva=1', ok: auth.can('campo:write') && auth.hasModule('M1') },
  { label: 'Registrar riego', icon: Droplets, to: '/campo?tab=riegos&nueva=1', ok: auth.can('campo:write') && auth.hasModule('M1') },
  { label: 'Pasar asistencia', icon: ClipboardCheck, to: '/trabajadores?tab=asistencia', ok: auth.can('trabajadores:write') && auth.hasModule('M3') },
  { label: 'Escanear QR', icon: QrCode, to: '/trazabilidad?escanear=1', ok: auth.can('trazabilidad:read') && auth.hasModule('M2') },
].filter(q => q.ok));

async function loadAlertas() { try { alertas.value = await api.get('/alertas'); } catch { /* silencioso: no bloquea la UI */ } }
const toggle = (n) => { openMenu.value = openMenu.value === n ? null : n; };
const closeAll = (e) => { if (!e.target.closest('.menu-wrap')) openMenu.value = null; };
let timer;
onMounted(() => { loadAlertas(); timer = setInterval(loadAlertas, 120000); document.addEventListener('click', closeAll); });
onBeforeUnmount(() => { clearInterval(timer); document.removeEventListener('click', closeAll); });
watch(() => route.fullPath, () => { ui.sidebarOpen = false; openMenu.value = null; });
async function salir() { await auth.logout(); router.replace({ name: 'login' }); }
const sinMsg = computed(() => ({ modulo: 'Ese módulo está desactivado para tu finca.', permiso: 'Tu rol no tiene permiso para esa sección.' })[route.query.sin]);
</script>

<template>
  <div class="shell">
    <div class="scrim" :class="{ show: ui.sidebarOpen }" @click="ui.sidebarOpen = false" />
    <aside class="sidebar" :class="{ open: ui.sidebarOpen }" aria-label="Navegación principal">
      <div class="brand"><img src="/favicon.svg" alt="" /><div><b>CRM-Agro</b><span>del campo a la nube</span></div></div>
      <nav class="nav">
        <template v-for="m in items" :key="m.name">
          <span v-if="m.off" class="nav-off" :title="`Módulo ${m.module} desactivado para esta finca`"><span class="row" style="gap:12px"><component :is="Icons[m.icon]" :size="20" />{{ m.label }}</span><span class="tag">No disponible</span></span>
          <RouterLink v-else :to="m.menuPath || m.path"><component :is="Icons[m.icon]" :size="20" />{{ m.label }}</RouterLink>
        </template>
      </nav>
      <div class="sidebar-foot">{{ auth.finca?.nombre }}<br />v1.0 · Integraciones WhatsApp/IA: pendientes</div>
    </aside>

    <div class="main">
      <header class="topbar">
        <button class="btn icon ghost burger" aria-label="Abrir menú" @click="ui.sidebarOpen = true"><Menu :size="22" /></button>
        <div class="grow"><strong class="small muted">{{ auth.finca?.nombre }}</strong></div>

        <div class="menu-wrap" style="position:relative" v-if="quick.length">
          <button class="btn sm primary" @click.stop="toggle('quick')" aria-haspopup="menu"><Plus :size="16" /><span class="hide-sm">Acceso rápido</span></button>
          <div v-if="openMenu === 'quick'" class="dropdown" role="menu" style="width:260px">
            <RouterLink v-for="q in quick" :key="q.label" :to="q.to" class="item" style="color:inherit;align-items:center"><component :is="q.icon" :size="18" /><b>{{ q.label }}</b></RouterLink>
          </div>
        </div>

        <div class="menu-wrap" style="position:relative">
          <button class="btn icon ghost" aria-label="Notificaciones" @click.stop="toggle('bell')"><Bell :size="21" /><span v-if="alertas.length" class="count">{{ alertas.length > 99 ? '99+' : alertas.length }}</span></button>
          <div v-if="openMenu === 'bell'" class="dropdown">
            <div class="item" style="font-weight:800">Alertas ({{ alertas.length }})</div>
            <div v-if="!alertas.length" class="empty">Sin alertas pendientes 🎉</div>
            <RouterLink v-for="(a, i) in alertas.slice(0, 12)" :key="i" :to="a.ruta" class="item" style="color:inherit"><span class="dot" :class="a.severidad" /><div><b>{{ a.titulo }}</b><div class="muted small">{{ a.detalle }}</div></div></RouterLink>
          </div>
        </div>

        <div class="menu-wrap" style="position:relative">
          <button class="menu-btn" @click.stop="toggle('user')" aria-haspopup="menu"><span class="avatar">{{ initials(auth.usuario?.nombre) }}</span></button>
          <div v-if="openMenu === 'user'" class="dropdown" style="width:270px">
            <div class="item" style="flex-direction:column;gap:2px"><b>{{ auth.usuario?.nombre }}</b><span class="muted small">{{ auth.usuario?.email }}</span><span class="badge ok" style="width:fit-content;margin-top:4px">{{ auth.usuario?.rol_nombre || auth.usuario?.rol }}</span></div>
            <RouterLink to="/configuracion?tab=perfil" class="item" style="color:inherit;align-items:center"><UserRound :size="18" />Mi perfil</RouterLink>
            <RouterLink to="/configuracion?tab=password" class="item" style="color:inherit;align-items:center"><KeyRound :size="18" />Cambiar contraseña</RouterLink>
            <a href="#" class="item" style="color:var(--danger);align-items:center" @click.prevent="salir"><LogOut :size="18" />Cerrar sesión</a>
          </div>
        </div>
      </header>
      <main class="content">
        <div v-if="sinMsg" class="callout danger" style="margin-bottom:16px"><Lock :size="16" style="vertical-align:-3px" /> {{ sinMsg }}</div>
        <RouterView :key="route.path" />
      </main>
    </div>
  </div>
</template>

<style>
@media (max-width: 680px) { .hide-sm { display: none; } }
</style>
