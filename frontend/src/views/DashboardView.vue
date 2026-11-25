<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { Map as MapIcon, Sprout, Wheat, Users, Boxes, PackageMinus, ListTodo, CalendarClock, ShoppingCart, TrendingUp, TrendingDown, Wallet, ClipboardCheck, CircleAlert, ShieldAlert, Info, Plus, QrCode } from 'lucide-vue-next';
import PageHead from '../components/PageHead.vue';
import StatCard from '../components/StatCard.vue';
import ChartCanvas from '../components/ChartCanvas.vue';
import { api } from '../api/http.js';
import { useAuth } from '../stores/auth.js';
import { useUi } from '../stores/ui.js';
import { fmtMoney, fmtNum, fmtDate, fmtMonth, addDays, today, pct, labelize } from '../utils/format.js';
import { PALETTE, COLOR } from '../utils/palette.js';

const auth = useAuth(); const ui = useUi();
const d = ref(null); const loading = ref(true); const dias = ref(30);
const M = (v) => fmtMoney(v, auth.moneda);

async function load() {
  loading.value = true;
  try { d.value = await api.get('/dashboard', { desde: addDays(today(), -(dias.value - 1)), hasta: today() }); } catch (e) { ui.error(e); } finally { loading.value = false; }
}
onMounted(load); watch(dias, load);

const k = computed(() => d.value?.kpis || {});
const produccionTxt = computed(() => (k.value.produccion?.length ? k.value.produccion.map(p => `${fmtNum(p.cantidad)} ${p.unidad}`).join(' · ') : '0'));
const g = computed(() => d.value?.graficos || {});
const ivc = computed(() => g.value.ingresos_vs_costos && {
  labels: g.value.ingresos_vs_costos.map(m => fmtMonth(m.mes)),
  datasets: [
    { type: 'bar', label: 'Ingresos', data: g.value.ingresos_vs_costos.map(m => m.ingresos), backgroundColor: COLOR.ingresos, borderRadius: 6, maxBarThickness: 28 },
    { type: 'bar', label: 'Costos', data: g.value.ingresos_vs_costos.map(m => m.costos), backgroundColor: COLOR.costos, borderRadius: 6, maxBarThickness: 28 },
    { type: 'line', label: 'Margen', data: g.value.ingresos_vs_costos.map(m => m.margen), borderColor: COLOR.margen, backgroundColor: COLOR.margen, tension: .35, pointRadius: 4 },
  ],
});
const prod = computed(() => {
  const rows = g.value.produccion_mensual; if (!rows) return null;
  const meses = [...new Set(rows.map(r => r.mes))].sort(); const cultivos = [...new Set(rows.map(r => r.cultivo))];
  return { labels: meses.map(fmtMonth), datasets: cultivos.map((c, i) => ({ label: c, data: meses.map(m => rows.filter(r => r.mes === m && r.cultivo === c).reduce((s, r) => s + r.cantidad, 0)), backgroundColor: PALETTE[i % PALETTE.length], borderRadius: 4, stack: 's' })) };
});
const ventasChart = computed(() => g.value.ventas_mensual && { labels: g.value.ventas_mensual.map(m => fmtMonth(m.mes)), datasets: [{ label: 'Ventas', data: g.value.ventas_mensual.map(m => m.total), borderColor: COLOR.ventas, backgroundColor: 'rgba(31,138,158,.15)', fill: true, tension: .35, pointRadius: 4 }] });
const costosCat = computed(() => g.value.costos_por_categoria?.length ? { labels: g.value.costos_por_categoria.map(c => labelize(c.categoria)), datasets: [{ data: g.value.costos_por_categoria.map(c => c.monto), backgroundColor: PALETTE, borderWidth: 2, borderColor: '#fffdf8' }] } : null);
const cal = computed(() => { const m = {}; for (const e of d.value?.calendario || []) (m[e.fecha] ??= []).push(e); return Object.entries(m).slice(0, 7); });
const sevIcon = { danger: ShieldAlert, warning: CircleAlert, info: Info };
const accesos = computed(() => [
  { t: 'Nueva venta', i: ShoppingCart, to: '/ventas?nueva=1', ok: auth.can('ventas:write') && auth.hasModule('M5') },
  { t: 'Registrar cosecha', i: Wheat, to: '/campo?tab=cosechas&nueva=1', ok: auth.can('campo:write') && auth.hasModule('M1') },
  { t: 'Pasar asistencia', i: ClipboardCheck, to: '/trabajadores?tab=asistencia', ok: auth.can('trabajadores:write') && auth.hasModule('M3') },
  { t: 'Escanear QR', i: QrCode, to: '/trazabilidad?escanear=1', ok: auth.can('trazabilidad:read') && auth.hasModule('M2') },
  { t: 'Entrada de inventario', i: Boxes, to: '/inventarios?tab=movimientos&nueva=1', ok: auth.can('inventario:write') && auth.hasModule('M4') },
].filter(a => a.ok));
</script>

<template>
  <PageHead :title="`Hola, ${auth.usuario?.nombre?.split(' ')[0] || ''}`" subtitle="Resumen operativo de tu finca con datos en tiempo real.">
    <select class="input" style="width:auto" v-model.number="dias" aria-label="Período"><option :value="7">Últimos 7 días</option><option :value="30">Últimos 30 días</option><option :value="90">Últimos 90 días</option><option :value="365">Último año</option></select>
  </PageHead>

  <div v-if="loading && !d" class="grid g4"><div v-for="i in 8" :key="i" class="card kpi"><div class="skeleton" style="height:90px" /></div></div>
  <template v-else-if="d">
    <section class="grid g4 keep2" aria-label="Indicadores">
      <StatCard label="Lotes" :value="k.lotes_total" :sub="`${k.lotes_activos} activos`" :icon="MapIcon" to="/lotes" />
      <StatCard label="Cultivos activos" :value="k.cultivos_activos" sub="En campo ahora" :icon="Sprout" to="/lotes?tab=plantaciones" />
      <StatCard v-if="k.produccion" label="Producción cosechada" :value="produccionTxt" :sub="`Últimos ${dias} días`" :icon="Wheat" tone="amber" to="/campo?tab=cosechas" />
      <StatCard v-if="k.trabajadores !== undefined" label="Trabajadores" :value="k.trabajadores" :sub="`Hoy: ${k.asistencia_hoy.presentes} presentes · ${k.asistencia_hoy.ausentes} aus. · ${k.asistencia_hoy.sin_registro} sin registro`" :icon="Users" to="/trabajadores?tab=asistencia" />
      <StatCard v-if="k.inventario_valor !== undefined" label="Inventario disponible" :value="M(k.inventario_valor)" sub="Valorizado a costo promedio" :icon="Boxes" tone="teal" to="/inventarios" />
      <StatCard v-if="k.productos_stock_bajo !== undefined" label="Stock bajo" :value="k.productos_stock_bajo" :sub="k.productos_stock_bajo ? 'Productos por reponer' : 'Todo en orden'" :icon="PackageMinus" :tone="k.productos_stock_bajo ? 'clay' : ''" to="/inventarios?bajo=1" />
      <StatCard v-if="k.labores_pendientes !== undefined" label="Labores pendientes" :value="k.labores_pendientes" :sub="`${k.aplicaciones_pendientes} aplicaciones pendientes`" :icon="ListTodo" :tone="k.labores_pendientes ? 'amber' : ''" to="/campo?tab=labores" />
      <StatCard v-if="k.proximas_cosechas !== undefined" label="Próximas cosechas" :value="k.proximas_cosechas" sub="En los próximos 30 días" :icon="CalendarClock" to="/campo?tab=calendario" />
      <StatCard v-if="k.ventas_periodo" label="Ventas del período" :value="k.ventas_periodo.cantidad" :sub="`${M(k.ventas_periodo.total)} · por cobrar ${M(k.cuentas_por_cobrar)}`" :icon="ShoppingCart" tone="teal" to="/ventas" />
      <StatCard v-if="k.ingresos !== undefined" label="Ingresos" :value="M(k.ingresos)" :sub="`Últimos ${dias} días`" :icon="TrendingUp" to="/finanzas" />
      <StatCard v-if="k.costos !== undefined" label="Costos" :value="M(k.costos)" sub="Insumos, jornales y gastos" :icon="TrendingDown" tone="clay" to="/finanzas" />
      <StatCard v-if="k.margen !== undefined" label="Margen operativo" :value="M(k.margen)" :sub="`Margen ${pct(k.margen_pct)}`" :icon="Wallet" :tone="k.margen < 0 ? 'clay' : 'amber'" to="/finanzas" />
    </section>

    <section v-if="accesos.length" class="row" style="margin:18px 0 4px" aria-label="Accesos rápidos"><b class="small muted" style="text-transform:uppercase;letter-spacing:.06em">Accesos rápidos</b>
      <RouterLink v-for="a in accesos" :key="a.t" :to="a.to" class="btn sm"><component :is="a.i" :size="15" />{{ a.t }}</RouterLink></section>

    <section class="grid g-main" style="margin-top:16px">
      <div class="stack">
        <div v-if="ivc" class="card"><div class="card-head"><h3>Ingresos vs. costos (6 meses)</h3><span class="muted small">Del margen operativo</span></div><div class="card-pad"><ChartCanvas :data="ivc" /></div></div>
        <div class="grid g2">
          <div v-if="prod" class="card"><div class="card-head"><h3>Producción por cultivo</h3></div><div class="card-pad"><ChartCanvas :data="prod" small :options="{ scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } } }" /></div></div>
          <div v-if="ventasChart" class="card"><div class="card-head"><h3>Evolución de ventas</h3></div><div class="card-pad"><ChartCanvas type="line" :data="ventasChart" small :options="{ plugins: { legend: { display: false } } }" /></div></div>
        </div>
        <div v-if="d.lotes.length" class="card"><div class="card-head"><h3>Resumen de lotes</h3><RouterLink to="/lotes" class="small">Ver todos</RouterLink></div>
          <div class="table-wrap"><table class="t stack-sm"><thead><tr><th>Lote</th><th>Cultivo</th><th class="num">Superficie</th><th>Cosecha estimada</th><th class="num">Labores pend.</th><th class="num">Cosechado</th></tr></thead>
            <tbody><tr v-for="l in d.lotes" :key="l.id"><td data-label="Lote"><b>{{ l.codigo }}</b> · {{ l.nombre }}</td><td data-label="Cultivo">{{ l.cultivo || '— sin cultivo' }}</td><td data-label="Superficie" class="num">{{ fmtNum(l.superficie_ha) }} ha</td><td data-label="Cosecha est.">{{ fmtDate(l.fecha_cosecha_estimada) }}</td><td data-label="Labores" class="num">{{ l.labores_pendientes ?? '—' }}</td><td data-label="Cosechado" class="num">{{ l.cosechado !== undefined ? fmtNum(l.cosechado) : '—' }}</td></tr></tbody></table></div></div>
      </div>

      <div class="stack">
        <div class="card"><div class="card-head"><h3>Alertas importantes</h3><span class="badge" :class="d.alertas.length ? 'danger' : 'ok'">{{ d.alertas.length }}</span></div>
          <div class="card-pad"><div v-if="!d.alertas.length" class="muted">Sin alertas pendientes.</div>
            <ul class="list"><li v-for="(a, i) in d.alertas" :key="i"><component :is="sevIcon[a.severidad]" :size="18" :style="{ color: a.severidad === 'danger' ? 'var(--danger)' : a.severidad === 'warning' ? 'var(--warn)' : 'var(--info)', flex: 'none', marginTop: '2px' }" /><RouterLink :to="a.ruta" style="color:inherit;text-decoration:none"><b>{{ a.titulo }}</b><div class="muted small">{{ a.detalle }}</div></RouterLink></li></ul></div></div>
        <div v-if="d.calendario.length || cal.length" class="card"><div class="card-head"><h3>Calendario · próximos 14 días</h3><RouterLink to="/campo?tab=calendario" class="small">Abrir</RouterLink></div>
          <div class="card-pad"><div v-if="!cal.length" class="muted">Sin actividades programadas.</div>
            <ul class="list"><li v-for="[fecha, evs] in cal" :key="fecha"><div style="min-width:78px" class="small"><b>{{ fmtDate(fecha) }}</b></div><div class="stack" style="gap:4px"><span v-for="(e, i) in evs" :key="i" class="small">{{ e.titulo }} <span class="muted">· {{ e.detalle }}</span></span></div></li></ul></div></div>
        <div v-if="d.proximas_cosechas.length" class="card"><div class="card-head"><h3>Próximas cosechas</h3></div><div class="card-pad"><ul class="list"><li v-for="c in d.proximas_cosechas" :key="c.id"><Wheat :size="18" style="color:var(--amber);flex:none;margin-top:2px" /><div><b>{{ c.cultivo }}</b> · {{ c.lote }}<div class="muted small">Estimada: {{ fmtDate(c.fecha) }}</div></div></li></ul></div></div>
        <div v-if="costosCat" class="card"><div class="card-head"><h3>Costos por categoría</h3></div><div class="card-pad"><ChartCanvas type="doughnut" :data="costosCat" small :options="{ plugins: { legend: { position: 'bottom' } } }" /></div></div>
        <div class="card"><div class="card-head"><h3>Actividad reciente</h3></div><div class="card-pad"><div v-if="!d.actividad.length" class="muted">Aún no hay actividad.</div><ul class="list"><li v-for="(a, i) in d.actividad" :key="i"><span class="badge" style="flex:none">{{ fmtDate(a.fecha) }}</span><span class="small">{{ a.texto }}</span></li></ul></div></div>
      </div>
    </section>
  </template>
</template>
