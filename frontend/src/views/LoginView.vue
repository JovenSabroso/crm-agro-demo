<script setup>
import { reactive, ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/http.js';
import { useAuth } from '../stores/auth.js';
import { useUi } from '../stores/ui.js';

const props = defineProps({ modo: { type: String, default: 'login' } });
const auth = useAuth(); const ui = useUi(); const router = useRouter(); const route = useRoute();
const loading = ref(false); const error = ref(''); const info = ref(''); const devToken = ref('');
const f = reactive({ email: '', password: '', nombre: '', finca: '', ubicacion: '', token: '', password2: '' });
const showDemo = import.meta.env.VITE_SHOW_DEMO !== 'false';
const demo = [['Propietario', 'propietario@crmagro.test'], ['Encargado', 'encargado@crmagro.test'], ['Trabajador', 'trabajador@crmagro.test']];
const pwdOk = computed(() => f.password.length >= 8 && /[A-Za-z]/.test(f.password) && /\d/.test(f.password));

async function submit() {
  error.value = ''; info.value = ''; loading.value = true;
  try {
    if (props.modo === 'registro') {
      if (!pwdOk.value) throw new Error('La contraseña debe tener mínimo 8 caracteres, con letras y números.');
      await auth.registro({ finca: { nombre: f.finca, ubicacion: f.ubicacion || undefined }, nombre: f.nombre, email: f.email, password: f.password });
      ui.success('Finca registrada. ¡Bienvenido a CRM-Agro!'); router.replace({ name: 'dashboard' });
    } else if (props.modo === 'recuperar') {
      if (!f.token) {
        const r = await api.post('/auth/olvide-password', { email: f.email }, { auth: false });
        info.value = r.mensaje; devToken.value = r.token_desarrollo || '';
      } else {
        if (!pwdOk.value) throw new Error('La nueva contraseña debe tener mínimo 8 caracteres, con letras y números.');
        await api.post('/auth/restablecer-password', { token: f.token, password: f.password }, { auth: false });
        ui.success('Contraseña restablecida. Ya puedes iniciar sesión.'); router.replace({ name: 'login' });
      }
    } else {
      await auth.login(f.email, f.password);
      router.replace(route.query.redirect || { name: 'dashboard' });
    }
  } catch (e) { error.value = e.fieldErrors && Object.values(e.fieldErrors).length ? Object.values(e.fieldErrors).join(' · ') : e.message; } finally { loading.value = false; }
}
</script>

<template>
  <div class="auth">
    <section class="auth-hero">
      <div class="row" style="position:relative;z-index:1"><img src="/favicon.svg" width="44" height="44" alt="" style="border-radius:12px" /><b style="font-family:var(--font-display);font-size:26px;color:#fff">CRM-Agro</b></div>
      <div style="position:relative;z-index:1"><h1>Gestión modular agrícola, del campo a la nube.</h1><p>Lotes, cultivos, trazabilidad con QR, trabajadores, inventarios, ventas, vivero y finanzas de tu finca. Actívalo por módulos, úsalo desde el celular.</p></div>
      <div class="mods"><span>Control de campo</span><span>Trazabilidad QR</span><span>Inventarios</span><span>Ventas</span><span>Vivero</span><span>Finanzas</span></div>
    </section>
    <section class="auth-form">
      <form class="auth-card stack" @submit.prevent="submit" novalidate>
        <div>
          <h2>{{ modo === 'registro' ? 'Registra tu finca' : modo === 'recuperar' ? 'Recuperar acceso' : 'Bienvenido' }}</h2>
          <p class="muted" style="margin:0">{{ modo === 'registro' ? 'Crea la finca y tu usuario propietario.' : modo === 'recuperar' ? 'Genera un token local y define una nueva contraseña.' : 'Ingresa con tu cuenta para continuar.' }}</p>
        </div>
        <div v-if="route.query.expirada" class="callout">Tu sesión expiró. Inicia sesión nuevamente.</div>
        <template v-if="modo === 'registro'">
          <div class="field"><label>Nombre de la finca <span class="req">*</span></label><input class="input" v-model="f.finca" required /></div>
          <div class="field"><label>Ubicación</label><input class="input" v-model="f.ubicacion" placeholder="Municipio, departamento" /></div>
          <div class="field"><label>Tu nombre <span class="req">*</span></label><input class="input" v-model="f.nombre" required autocomplete="name" /></div>
        </template>
        <div class="field"><label>Correo electrónico</label><input class="input" type="email" v-model="f.email" required autocomplete="username" inputmode="email" /></div>
        <div v-if="modo === 'recuperar' && info" class="callout ok">{{ info }}<template v-if="devToken"><br /><b>Token (solo desarrollo):</b> <button type="button" class="btn sm" style="margin-top:6px" @click="f.token = devToken">Usar token generado</button></template></div>
        <div v-if="modo === 'recuperar' && (f.token || info)" class="field"><label>Token de recuperación</label><input class="input" v-model="f.token" autocomplete="off" /></div>
        <div v-if="modo !== 'recuperar' || f.token" class="field"><label>{{ modo === 'recuperar' ? 'Nueva contraseña' : 'Contraseña' }}</label><input class="input" type="password" v-model="f.password" required :autocomplete="modo === 'login' ? 'current-password' : 'new-password'" /><span v-if="modo !== 'login'" class="hint">Mínimo 8 caracteres, con letras y números.</span></div>
        <div v-if="error" class="callout danger" role="alert">{{ error }}</div>
        <button class="btn primary" style="min-height:48px" :disabled="loading"><span v-if="loading" class="spinner" />{{ modo === 'registro' ? 'Crear finca' : modo === 'recuperar' ? (f.token ? 'Restablecer contraseña' : 'Generar token') : 'Iniciar sesión' }}</button>
        <div class="row between small">
          <RouterLink v-if="modo !== 'login'" to="/login">← Volver a iniciar sesión</RouterLink><RouterLink v-else to="/recuperar">¿Olvidaste tu contraseña?</RouterLink>
          <RouterLink v-if="modo === 'login'" to="/registro">Registrar una finca</RouterLink>
        </div>
        <div v-if="showDemo && modo === 'login'" class="card card-pad" style="background:var(--surface-2)">
          <div class="row between"><b class="small">Usuarios de demostración</b><span class="demo-badge">Datos ficticios</span></div>
          <div class="row" style="margin-top:8px"><button v-for="d in demo" :key="d[0]" type="button" class="btn sm" @click="f.email = d[1]; f.password = 'Demo1234'">{{ d[0] }}</button></div>
          <div class="hint small" style="margin-top:6px">Solo existen tras ejecutar <code>npm run seed</code> en el backend.</div>
        </div>
      </form>
    </section>
  </div>
</template>
