<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Download, FileText } from 'lucide-vue-next';
import PageHead from '../components/PageHead.vue';
import TabBar from '../components/TabBar.vue';
import ChartCanvas from '../components/ChartCanvas.vue';
import CrudView from '../components/CrudView.vue';
import StatCard from '../components/StatCard.vue';
import { api, downloadFile } from '../api/http.js';
import { useAuth } from '../stores/auth.js';
import { useUi } from '../stores/ui.js';
import { loadLookup, LK } from '../utils/lookups.js';
import { addDays, today, fmtMoney, fmtMonth, pct, labelize, fmtNum } from '../utils/format.js';
import { PALETTE, COLOR } from '../utils/palette.js';

const route = useRoute(); const auth = useAuth(); const ui = useUi();
const tabs = [{ key: 'resumen', label: 'Resumen y gráficos' }, { key: 'lotes', label: 'Por lote y cultivo' }, { key: 'comparacion', label: 'Comparar períodos' }, { key: 'gastos', label: 'Gastos' }, { key: 'ingresos', label: 'Otros ingresos' }];
const tab = ref(tabs.find(t => t.key === route.query.tab)?.key || 'resumen');
const M = (v) => fmtMoney(v, auth.moneda);
const f = reactive({ desde: addDays(today(), -89), hasta: today(), lote_id: '', cultivo_id: '', producto_id: '', trabajador_id: '', categoria: '' });
const opts = reactive({ lotes: [], cultivos: [], productos: [], trabajadores: [] });
const d = ref(null); const cmp = ref(null); const loading = ref(false);
const CATS = ['insumos', 'jornales', 'cosecha', 'vivero', 'mantenimiento', 'servicios', 'transporte', 'otros'].map(v => ({ value: v, label: labelize(v) }));

async function load() {
  loading.value = true;
  try { d.value = await api.get('/finanzas/resumen', f); if (tab.value === 'comparacion') cmp.value = await api.get('/finanzas/comparacion', f); } catch (e) { ui.error(e); } finally { loading.value = false; }
}
onMounted(async () => {
  load();
  for (const [k, lk] of [['lotes', 'lotes'], ['cultivos', 'cultivos'], ['productos', 'productos'], ['trabajadores', 'trabajadoresTodos']]) loadLookup(LK[lk].endpoint, { params: LK[lk].params, label: LK[lk].label }).then(o => { opts[k] = o; }).catch(() => {});
});
watch(f, load, { deep: true }); watch(tab, (t) => { if (t === 'comparacion') load(); });
const exportar = (formato) => downloadFile('/finanzas/exportar', { ...f, formato }, `reporte-financiero.${formato}`).catch(ui.error);

const r = computed(() => d.value?.resumen);
const mensual = computed(() => d.value && { labels: d.value.mensual.map(m => fmtMonth(m.mes)), datasets: [{ type: 'bar', label: 'Ingresos', data: d.value.mensual.map(m => m.ingresos), backgroundColor: COLOR.ingresos, borderRadius: 6 }, { type: 'bar', label: 'Costos', data: d.value.mensual.map(m => m.costos), backgroundColor: COLOR.costos, borderRadius: 6 }, { type: 'line', label: 'Margen', data: d.value.mensual.map(m => m.margen), borderColor: COLOR.margen, backgroundColor: COLOR.margen, tension: .3 }] });
const costosDon = computed(() => { if (!r.value) return null; const e = Object.entries(r.value.costos).filter(([k, v]) => k !== 'total' && v > 0); return e.length ? { labels: e.map(([k]) => labelize(k)), datasets: [{ data: e.map(([, v]) => v), backgroundColor: PALETTE, borderColor: '#fffdf8', borderWidth: 2 }] } : null; });
const rentLote = computed(() => d.value?.por_lote.length ? { labels: d.value.por_lote.map(l => l.codigo), datasets: [{ label: 'Margen', data: d.value.por_lote.map(l => l.margen), backgroundColor: d.value.por_lote.map(l => (l.margen >= 0 ? COLOR.ingresos : COLOR.costos)), borderRadius: 6 }] } : null);
const gastoFields = [{ key: 'fecha', label: 'Fecha', type: 'date', required: true, default: today }, { key: 'categoria', label: 'Categoría', type: 'select', required: true, options: CATS.filter(c => !['insumos', 'jornales'].includes(c.value)), default: 'otros' }, { key: 'descripcion', label: 'Descripción', required: true }, { key: 'monto', label: 'Monto', type: 'money', gt: 0, required: true }, { key: 'lote_id', label: 'Lote (opcional)', type: 'select', lookup: 'lotes' }];
const ingFields = [{ key: 'fecha', label: 'Fecha', type: 'date', required: true, default: today }, { key: 'categoria', label: 'Categoría', default: 'otros', required: true }, { key: 'descripcion', label: 'Descripción', required: true }, { key: 'monto', label: 'Monto', type: 'money', gt: 0, required: true }];
const rows = (arr, name) => arr || [];
</script>

<template>
  <PageHead title="Finanzas y reportes" subtitle="Cálculos obtenidos de los registros reales: insumos consumidos, jornales, gastos y ventas.">
    <button class="btn" @click="exportar('xlsx')"><Download :size="16" />Excel</button><button class="btn" @click="exportar('pdf')"><FileText :size="16" />PDF</button>
  </PageHead>
  <div class="card toolbar" style="margin-bottom:16px">
    <div class="field"><label>Desde</label><input class="input" type="date" v-model="f.desde" /></div><div class="field"><label>Hasta</label><input class="input" type="date" v-model="f.hasta" /></div>
    <div class="field"><label>Lote</label><select class="input" v-model="f.lote_id"><option value="">Todos</option><option v-for="o in opts.lotes" :key="o.value" :value="o.value">{{ o.label }}</option></select></div>
    <div class="field"><label>Cultivo</label><select class="input" v-model="f.cultivo_id"><option value="">Todos</option><option v-for="o in opts.cultivos" :key="o.value" :value="o.value">{{ o.label }}</option></select></div>
    <div class="field"><label>Producto</label><select class="input" v-model="f.producto_id"><option value="">Todos</option><option v-for="o in opts.productos" :key="o.value" :value="o.value">{{ o.label }}</option></select></div>
    <div class="field"><label>Trabajador</label><select class="input" v-model="f.trabajador_id"><option value="">Todos</option><option v-for="o in opts.trabajadores" :key="o.value" :value="o.value">{{ o.label }}</option></select></div>
    <div class="field"><label>Categoría de costo</label><select class="input" v-model="f.categoria"><option value="">Todas</option><option v-for="o in CATS" :key="o.value" :value="o.value">{{ o.label }}</option></select></div>
  </div>
  <TabBar v-model="tab" :tabs="tabs" />

  <template v-if="d && ['resumen', 'lotes', 'comparacion'].includes(tab)">
    <div class="grid g4 keep2" style="margin-bottom:16px"><StatCard label="Ingresos" :value="M(r.ingresos.total)" :sub="`Ventas ${M(r.ingresos.ventas)} · Vivero ${M(r.ingresos.vivero)}`" /><StatCard label="Costos" tone="clay" :value="M(r.costos.total)" :sub="`Insumos ${M(r.costos.insumos)} · Jornales ${M(r.costos.jornales)}`" />
      <StatCard label="Margen operativo" tone="amber" :value="M(r.margen_operativo)" :sub="`Margen ${pct(r.margen_pct)}`" /><StatCard label="Por cobrar" tone="teal" :value="M(r.cuentas_por_cobrar)" :sub="`Cobros ${M(r.cobros_recibidos)} · Pagos a trabajadores ${M(r.pagos_a_trabajadores)}`" /></div>
  </template>
  <div v-if="d && tab === 'resumen'" class="grid g-main"><div class="card"><div class="card-head"><h3>Evolución mensual</h3></div><div class="card-pad"><ChartCanvas v-if="d.mensual.length" :data="mensual" /><div v-else class="empty">Sin movimientos en el período.</div></div></div>
    <div class="stack"><div class="card"><div class="card-head"><h3>Costos por categoría</h3></div><div class="card-pad"><ChartCanvas v-if="costosDon" type="doughnut" small :data="costosDon" /><div v-else class="empty">Sin costos.</div></div></div>
      <div class="card"><div class="card-head"><h3>Margen por lote</h3></div><div class="card-pad"><ChartCanvas v-if="rentLote" small :data="rentLote" :options="{ plugins: { legend: { display: false } } }" /><div v-else class="empty">Sin datos.</div></div></div></div></div>
  <template v-if="d && tab === 'lotes'">
    <div v-for="[titulo, arr, key] in [['Rentabilidad por lote', d.por_lote, 'codigo'], ['Rentabilidad por cultivo', d.por_cultivo, 'nombre']]" :key="titulo" class="card" style="margin-bottom:16px"><div class="card-head"><h3>{{ titulo }}</h3></div>
      <div class="table-wrap"><table class="t stack-sm"><thead><tr><th>{{ key === 'codigo' ? 'Lote' : 'Cultivo' }}</th><th class="num">Ingresos</th><th class="num">Insumos</th><th class="num">Jornales</th><th class="num">Cosecha</th><th class="num">Otros</th><th class="num">Costo total</th><th class="num">Margen</th><th class="num">Rent.</th></tr></thead>
        <tbody><tr v-for="x in arr" :key="x.lote_id || x.cultivo_id"><td data-label="Nombre"><b>{{ x.codigo ? x.codigo + ' · ' : '' }}{{ x.nombre }}</b></td><td data-label="Ingresos" class="num">{{ M(x.ingresos) }}</td><td data-label="Insumos" class="num">{{ M(x.costos.insumos) }}</td><td data-label="Jornales" class="num">{{ M(x.costos.jornales) }}</td><td data-label="Cosecha" class="num">{{ M(x.costos.cosecha) }}</td><td data-label="Otros" class="num">{{ M(x.costo_total - x.costos.insumos - x.costos.jornales - x.costos.cosecha) }}</td><td data-label="Costo total" class="num">{{ M(x.costo_total) }}</td><td data-label="Margen" class="num" :style="{ color: x.margen < 0 ? 'var(--danger)' : 'var(--ok)', fontWeight: 800 }">{{ M(x.margen) }}</td><td data-label="Rent." class="num">{{ pct(x.rentabilidad_pct) }}</td></tr></tbody></table><div v-if="!arr.length" class="empty">Sin datos para los filtros aplicados.</div></div></div>
  </template>
  <div v-if="tab === 'comparacion' && cmp" class="card card-pad stack"><p class="muted" style="margin:0">Período actual {{ cmp.periodo_actual.desde }} → {{ cmp.periodo_actual.hasta }} vs. anterior {{ cmp.periodo_anterior.desde }} → {{ cmp.periodo_anterior.hasta }}</p>
    <table class="t"><thead><tr><th>Concepto</th><th class="num">Actual</th><th class="num">Anterior</th><th class="num">Variación</th></tr></thead><tbody>
      <tr><td>Ingresos</td><td class="num">{{ M(cmp.actual.ingresos.total) }}</td><td class="num">{{ M(cmp.anterior.ingresos.total) }}</td><td class="num">{{ M(cmp.variacion.ingresos_abs) }} ({{ pct(cmp.variacion.ingresos_pct) }})</td></tr>
      <tr><td>Costos</td><td class="num">{{ M(cmp.actual.costos.total) }}</td><td class="num">{{ M(cmp.anterior.costos.total) }}</td><td class="num">{{ M(cmp.variacion.costos_abs) }} ({{ pct(cmp.variacion.costos_pct) }})</td></tr>
      <tr><td><b>Margen operativo</b></td><td class="num">{{ M(cmp.actual.margen_operativo) }}</td><td class="num">{{ M(cmp.anterior.margen_operativo) }}</td><td class="num">{{ M(cmp.variacion.margen_abs) }} ({{ pct(cmp.variacion.margen_pct) }})</td></tr></tbody></table>
    <ChartCanvas small :data="{ labels: ['Ingresos', 'Costos', 'Margen'], datasets: [{ label: 'Actual', data: [cmp.actual.ingresos.total, cmp.actual.costos.total, cmp.actual.margen_operativo], backgroundColor: COLOR.ingresos, borderRadius: 6 }, { label: 'Anterior', data: [cmp.anterior.ingresos.total, cmp.anterior.costos.total, cmp.anterior.margen_operativo], backgroundColor: '#b9c4bb', borderRadius: 6 }] }" /></div>

  <CrudView v-if="tab === 'gastos'" endpoint="/gastos" noun="gasto" write-perm="finanzas:write" :columns="[{ key: 'fecha', label: 'Fecha', type: 'date', sortable: true }, { key: 'categoria', label: 'Categoría', type: 'badge' }, { key: 'descripcion', label: 'Descripción' }, { key: 'lote_nombre', label: 'Lote' }, { key: 'monto', label: 'Monto', type: 'money', sortable: true }]" :fields="gastoFields" date-filter default-sort="fecha"
    hint="Aquí se registran gastos manuales. Los costos de insumos (consumos de inventario) y jornales se toman automáticamente de sus módulos." :filters="[{ key: 'categoria', label: 'Categoría', options: CATS.filter(c => !['insumos', 'jornales'].includes(c.value)) }]" @changed="load" />
  <CrudView v-if="tab === 'ingresos'" endpoint="/ingresos" noun="ingreso" write-perm="finanzas:write" :columns="[{ key: 'fecha', label: 'Fecha', type: 'date', sortable: true }, { key: 'categoria', label: 'Categoría' }, { key: 'descripcion', label: 'Descripción' }, { key: 'monto', label: 'Monto', type: 'money', sortable: true }]" :fields="ingFields" date-filter default-sort="fecha" hint="Ingresos no provenientes de ventas del sistema. Las ventas se registran en Ventas y clientes." @changed="load" />
</template>
