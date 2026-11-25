<script setup>
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ShieldCheck, ShieldAlert, MapPin, Sprout, Wheat, Droplets, FlaskConical } from 'lucide-vue-next';
import { api } from '../api/http.js';
import { fmtDate, fmtNum } from '../utils/format.js';

/** Ficha PÚBLICA de trazabilidad (consulta del cliente al escanear el QR). No requiere sesión y no muestra datos internos. */
const route = useRoute();
const t = ref(null); const error = ref(''); const loading = ref(true);
onMounted(async () => {
  try { t.value = await api.publicGet(`/public/trazabilidad/${route.params.codigo}`); }
  catch (e) { error.value = e.status === 404 ? 'No encontramos este lote. Verifica que el código del QR sea correcto.' : e.message; } finally { loading.value = false; }
});
</script>

<template>
  <div class="public">
    <div class="wrap">
      <header><img src="/favicon.svg" width="34" height="34" alt="" style="border-radius:9px" /><b style="font-family:var(--font-display);font-size:22px">CRM-Agro</b><span style="opacity:.7;margin-left:6px">Trazabilidad del producto</span></header>
      <div v-if="loading" class="card card-pad"><div class="skeleton" style="height:30px;margin-bottom:12px" /><div class="skeleton" /></div>
      <div v-else-if="error" class="card card-pad"><h2>Lote no encontrado</h2><p class="muted">{{ error }}</p></div>
      <template v-else>
        <div class="card hero stack">
          <div class="row between">
            <div><div class="muted small">Producto</div><div class="big">{{ t.cultivo.nombre }} <small v-if="t.cultivo.variedad" style="font-size:.55em;color:var(--muted)">{{ t.cultivo.variedad }}</small></div></div>
            <span class="badge" :class="t.comercializable ? 'ok' : 'danger'" style="font-size:13px;padding:6px 12px"><ShieldCheck v-if="t.comercializable" :size="16" /><ShieldAlert v-else :size="16" />{{ t.comercializable ? 'Apto para comercializar' : 'No liberado para la venta' }}</span>
          </div>
          <dl class="kv">
            <dt>Código de lote</dt><dd class="mono"><b>{{ t.codigo }}</b></dd>
            <dt>Productor</dt><dd><MapPin :size="14" style="vertical-align:-2px" /> {{ t.finca.nombre }}<span v-if="t.finca.ubicacion"> · {{ t.finca.ubicacion }}</span></dd>
            <dt>Lote de origen</dt><dd>{{ t.lote.nombre }}</dd>
            <dt>Siembra</dt><dd>{{ fmtDate(t.siembra.fecha) }}</dd>
            <dt>Cosecha</dt><dd>{{ fmtDate(t.cosecha.fecha) }} · {{ fmtNum(t.cosecha.cantidad) }} {{ t.cosecha.unidad }}<span v-if="t.cosecha.calidad"> · Calidad: {{ t.cosecha.calidad }}</span></dd>
            <dt>Período de carencia</dt><dd><span class="badge" :class="t.carencia.cumple ? 'ok' : 'danger'">{{ t.carencia.cumple ? 'Cumplido' : 'No cumplido' }}</span></dd>
            <dt>Riego</dt><dd><Droplets :size="14" style="vertical-align:-2px" /> {{ t.riego.registros }} registro(s) de riego durante el cultivo</dd>
          </dl>
        </div>
        <div class="card card-pad" style="margin-top:16px">
          <h3 style="margin-bottom:14px">Historia del producto</h3>
          <ol class="timeline">
            <li v-for="(e, i) in t.linea_tiempo" :key="i" :class="e.etapa"><div class="when">{{ fmtDate(e.fecha) }}</div><b>{{ e.titulo }}</b><div v-if="e.detalle" class="muted small">{{ e.detalle }}</div></li>
          </ol>
        </div>
        <p class="muted small" style="text-align:center;margin-top:18px">Información declarada por el productor y verificable mediante el código de lote. Esta ficha no contiene datos personales ni internos de la finca.</p>
      </template>
    </div>
  </div>
</template>
