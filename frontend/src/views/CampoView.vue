<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ChevronLeft, ChevronRight, Check, X, ShieldCheck, ShieldOff, Boxes, QrCode, Syringe } from 'lucide-vue-next';
import PageHead from '../components/PageHead.vue';
import TabBar from '../components/TabBar.vue';
import CrudView from '../components/CrudView.vue';
import FormModal from '../components/FormModal.vue';
import { api } from '../api/http.js';
import { useAuth } from '../stores/auth.js';
import { useUi } from '../stores/ui.js';
import { ESTADOS_TAREA, fmtDate, fmtNum, today, addDays } from '../utils/format.js';

const route = useRoute(); const router = useRouter(); const auth = useAuth(); const ui = useUi();
const tabs = [{ key: 'calendario', label: 'Calendario' }, { key: 'labores', label: 'Labores' }, { key: 'riegos', label: 'Riego' }, { key: 'aplicaciones', label: 'Aplicaciones fitosanitarias' }, { key: 'cosechas', label: 'Cosechas' }];
const tab = ref(tabs.find(t => t.key === route.query.tab)?.key || 'calendario');
const auto = computed(() => route.query.nueva === '1');
const wr = 'campo:write';

// ---------- Calendario ----------
const cursor = ref(new Date()); const events = ref([]); const dayOpen = ref(null);
const monthLabel = computed(() => cursor.value.toLocaleDateString('es-BO', { month: 'long', year: 'numeric' }));
const grid = computed(() => {
  const y = cursor.value.getFullYear(), m = cursor.value.getMonth(); const first = new Date(y, m, 1); const start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return { iso, day: d.getDate(), other: d.getMonth() !== m, today: iso === today(), evs: events.value.filter(e => e.fecha === iso) }; });
});
async function loadCal() { const a = grid.value[0].iso, b = grid.value[41].iso; try { events.value = await api.get('/campo/calendario', { desde: a, hasta: b }); } catch (e) { ui.error(e); } }
const move = (n) => { cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + n, 1); loadCal(); };
onMounted(() => { if (tab.value === 'calendario') loadCal(); });
watch(tab, (t) => { if (t === 'calendario') loadCal(); });

// ---------- Labores ----------
const EST = ESTADOS_TAREA;
const laborCols = [{ key: 'fecha_programada', label: 'Fecha', type: 'date', sortable: true, sortKey: 'fecha' }, { key: 'tipo', label: 'Labor', sortable: true }, { key: 'lote_nombre', label: 'Lote', format: r => `${r.lote_codigo} · ${r.lote_nombre}`, sortable: true, sortKey: 'lote' }, { key: 'responsable_nombre', label: 'Responsable' }, { key: 'estado', label: 'Estado', type: 'badge', sortable: true }];
const laborFields = [{ key: 'lote_id', label: 'Lote', type: 'select', lookup: 'lotes', required: true }, { key: 'tipo', label: 'Labor', required: true, placeholder: 'Deshierbe, poda, fertilización…' }, { key: 'fecha_programada', label: 'Fecha programada', type: 'date', required: true, default: today },
  { key: 'estado', label: 'Estado', type: 'select', options: EST, required: true, default: 'pendiente' }, { key: 'responsable_id', label: 'Responsable', type: 'select', lookup: 'trabajadores' }, { key: 'descripcion', label: 'Descripción', type: 'textarea' }, { key: 'observaciones', label: 'Observaciones', type: 'textarea' }];
const laborActions = [{ label: 'Completar', icon: Check, show: r => ['pendiente', 'en_curso'].includes(r.estado), run: async (r, { reload }) => { await api.post(`/labores/${r.id}/completar`, {}); ui.success('Labor completada'); reload(); } }];
const laborMap = (r) => ({ ...r });

// ---------- Riegos ----------
const riegoCols = [{ key: 'fecha', label: 'Fecha', type: 'date', sortable: true }, { key: 'lote_nombre', label: 'Lote', format: r => `${r.lote_codigo} · ${r.lote_nombre}`, sortable: true, sortKey: 'lote' }, { key: 'metodo', label: 'Método' }, { key: 'duracion_min', label: 'Duración (min)', type: 'num' }, { key: 'volumen_litros', label: 'Volumen (L)', type: 'num', sortable: true, sortKey: 'volumen' }, { key: 'responsable_nombre', label: 'Responsable' }];
const riegoFields = [{ key: 'lote_id', label: 'Lote', type: 'select', lookup: 'lotes', required: true }, { key: 'fecha', label: 'Fecha', type: 'date', required: true, default: today }, { key: 'metodo', label: 'Método', type: 'select', required: true, default: 'goteo', options: ['goteo', 'aspersión', 'surco', 'manual', 'otro'].map(v => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
  { key: 'duracion_min', label: 'Duración (min)', type: 'number', min: 0 }, { key: 'volumen_litros', label: 'Volumen (litros)', type: 'number', min: 0 }, { key: 'responsable_id', label: 'Responsable', type: 'select', lookup: 'trabajadores' }, { key: 'observaciones', label: 'Observaciones', type: 'textarea' }];

// ---------- Aplicaciones ----------
const aplCols = [{ key: 'fecha', label: 'Fecha', format: r => fmtDate(r.fecha_aplicacion || r.fecha_programada) }, { key: 'producto_nombre', label: 'Producto' }, { key: 'motivo', label: 'Motivo' }, { key: 'lote_nombre', label: 'Lote', format: r => `${r.lote_codigo} · ${r.lote_nombre}` },
  { key: 'responsable_nombre', label: 'Responsable' }, { key: 'carencia', label: 'Carencia', format: r => r.estado !== 'aplicada' ? `${r.periodo_carencia_dias} d` : (r.carencia_vigente ? `Vigente hasta ${fmtDate(r.fecha_fin_carencia)} (${r.dias_carencia_restantes} d)` : `Terminó ${fmtDate(r.fecha_fin_carencia)}`) }, { key: 'estado', label: 'Estado', type: 'badge' }];
const aplFields = [{ key: 'lote_id', label: 'Lote', type: 'select', lookup: 'lotes', required: true },
  { key: 'producto_id', label: 'Producto del inventario (agroquímico)', type: 'select', lookup: 'agroquimicos', hint: 'Si lo eliges, la cantidad usada se descuenta del inventario al aplicar.' }, { key: 'producto_nombre', label: 'Producto utilizado (nombre)', hint: 'Obligatorio si no eliges uno del inventario.' },
  { key: 'motivo', label: 'Motivo de la aplicación', required: true }, { key: 'fecha_programada', label: 'Fecha programada', type: 'date', default: today }, { key: 'fecha_aplicacion', label: 'Fecha de aplicación', type: 'date', hint: 'Déjala vacía si la aplicación queda pendiente.' },
  { key: 'periodo_carencia_dias', label: 'Período de carencia (días)', type: 'number', min: 0, max: 365, hint: 'Según la etiqueta del producto. Fin de carencia = aplicación + días.' }, { key: 'cantidad_usada', label: 'Cantidad usada', type: 'number', min: 0, hint: 'En la unidad del producto en inventario.' },
  { key: 'dosis_registrada', label: 'Dosis (transcrita de la etiqueta)', hint: 'Solo registro: el sistema nunca calcula ni sugiere dosis.', full: true }, { key: 'responsable_id', label: 'Responsable', type: 'select', lookup: 'trabajadores' }, { key: 'observaciones', label: 'Observaciones', type: 'textarea' }];
const aplActions = [
  { label: 'Aplicar', icon: Syringe, show: r => r.estado === 'pendiente', run: async (r, { reload }) => { const ok = await ui.confirm({ title: 'Registrar aplicación realizada', message: `Se registrará la aplicación de "${r.producto_nombre}" hoy y se calculará el fin del período de carencia${r.producto_id && r.cantidad_usada ? '; se descontará del inventario' : ''}.`, confirmText: 'Registrar aplicada' }); if (!ok) return; await api.post(`/aplicaciones/${r.id}/aplicar`, {}); ui.success('Aplicación registrada'); reload(); } },
  { label: 'Cancelar', icon: X, show: r => r.estado === 'pendiente', run: async (r, { reload }) => { if (!(await ui.confirm({ title: 'Cancelar aplicación', message: '¿Cancelar esta aplicación pendiente?', danger: true, confirmText: 'Cancelar aplicación' }))) return; await api.post(`/aplicaciones/${r.id}/cancelar`); reload(); } },
];
const aplBefore = (p) => { const o = { ...p }; for (const k of Object.keys(o)) if (o[k] === null) delete o[k]; return o; };

// ---------- Cosechas ----------
const cosCols = [{ key: 'fecha', label: 'Fecha', type: 'date' }, { key: 'cultivo', label: 'Cultivo', format: r => r.cultivo_variedad ? `${r.cultivo_nombre} ${r.cultivo_variedad}` : r.cultivo_nombre }, { key: 'lote', label: 'Lote', format: r => `${r.lote_codigo} · ${r.lote_nombre}` },
  { key: 'cantidad', label: 'Cantidad', format: r => `${fmtNum(r.cantidad)} ${r.unidad}` }, { key: 'codigo_lote_cosecha', label: 'Lote de cosecha' }, { key: 'comercializable', label: 'Comercializable', format: r => r.comercializable ? 'Sí' : 'Retenida' },
  { key: 'inv', label: 'En inventario', format: r => `${fmtNum(r.cantidad_inventariada)} / ${fmtNum(r.cantidad)}` }];
const cosFields = computed(() => [{ key: 'lote_id', label: 'Lote de procedencia', type: 'select', lookup: 'lotes', required: true, lockOnEdit: true }, { key: 'fecha', label: 'Fecha de cosecha', type: 'date', required: true, default: today }, { key: 'cantidad', label: 'Cantidad cosechada', type: 'number', gt: 0, required: true },
  { key: 'unidad', label: 'Unidad de medida', default: 'kg', lockOnEdit: true, hint: 'Por defecto la unidad del cultivo.' }, { key: 'calidad', label: 'Calidad' }, { key: 'responsable_id', label: 'Responsable', type: 'select', lookup: 'trabajadores' },
  { key: 'comercializable', label: 'Marcar como comercializable (se valida la carencia)', type: 'checkbox', default: false, showIf: () => true, full: true },
  ...(auth.hasModule('M4') && auth.can('inventario:write') ? [{ key: 'ingresar_inventario', label: 'Ingresar al inventario ahora', type: 'checkbox', default: false, full: true }] : []),
  { key: 'observaciones', label: 'Observaciones', type: 'textarea' }]);
const cosActions = computed(() => [
  { label: 'Liberar', icon: ShieldCheck, show: r => !r.comercializable, run: async (r, { reload }) => { await api.patch(`/cosechas/${r.id}/comercializable`, { comercializable: true }); ui.success('Cosecha liberada para la venta'); reload(); } },
  { label: 'Retener', icon: ShieldOff, show: r => r.comercializable && !r.stock_lote_vendido, run: async (r, { reload }) => { await api.patch(`/cosechas/${r.id}/comercializable`, { comercializable: false }); reload(); } },
  { label: 'A inventario', icon: Boxes, show: r => auth.hasModule('M4') && auth.can('inventario:write') && r.cantidad_inventariada < r.cantidad, run: (r) => { invModal.value = r; } },
  { label: 'QR', icon: QrCode, show: r => auth.hasModule('M2') && auth.can('trazabilidad:read'), run: (r) => router.push(`/trazabilidad/${r.codigo_lote_cosecha}`) },
]);
const invModal = ref(null);
async function ingresar(p) { const r = await api.post(`/cosechas/${invModal.value.id}/inventario`, { cantidad: p.cantidad ?? undefined, costo_unitario: p.costo_unitario ?? undefined }); ui.success('Cosecha ingresada al inventario'); crudCos.value?.reload(); return r; }
const crudCos = ref(null);
const cosBefore = (p) => { const o = { ...p }; for (const k of Object.keys(o)) if (o[k] === null) delete o[k]; return o; };
</script>

<template>
  <PageHead title="Control técnico de campo" subtitle="Labores, riego, aplicaciones fitosanitarias y cosechas por lote." />
  <TabBar v-model="tab" :tabs="tabs" />

  <div v-if="tab === 'calendario'" class="card card-pad">
    <div class="row between" style="margin-bottom:12px"><div class="row"><button class="btn icon sm" aria-label="Mes anterior" @click="move(-1)"><ChevronLeft :size="16" /></button><h3 style="min-width:150px;text-align:center;text-transform:capitalize">{{ monthLabel }}</h3><button class="btn icon sm" aria-label="Mes siguiente" @click="move(1)"><ChevronRight :size="16" /></button></div>
      <div class="row small muted"><span class="badge ok">Labor</span><span class="badge info">Riego</span><span class="badge danger">Aplicación / carencia</span><span class="badge warn">Cosecha</span></div></div>
    <div class="cal"><div v-for="d in ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']" :key="d" class="dow">{{ d }}</div>
      <div v-for="c in grid" :key="c.iso" class="day" :class="{ other: c.other, today: c.today }" @click="c.evs.length && (dayOpen = c)" :style="c.evs.length ? 'cursor:pointer' : ''"><b>{{ c.day }}</b><span v-for="(e, i) in c.evs.slice(0, 3)" :key="i" class="ev" :class="e.tipo">{{ e.titulo }}</span><span v-if="c.evs.length > 3" class="muted">+{{ c.evs.length - 3 }} más</span></div></div>
    <div v-if="dayOpen" class="modal-back" @click.self="dayOpen = null"><div class="modal sm"><div class="modal-head"><h2>{{ fmtDate(dayOpen.iso) }}</h2><button class="btn icon ghost" @click="dayOpen = null"><X :size="20" /></button></div><div class="modal-body"><ul class="list"><li v-for="(e, i) in dayOpen.evs" :key="i"><span class="ev" :class="e.tipo" style="flex:none">{{ e.tipo.replace('_', ' ') }}</span><div><b>{{ e.titulo }}</b><div class="muted small">{{ e.detalle }} · {{ e.estado }}</div></div></li></ul></div></div></div>
  </div>

  <CrudView v-else-if="tab === 'labores'" endpoint="/labores" noun="labor" plural="labores" :write-perm="wr" :columns="laborCols" :fields="laborFields" :row-actions="laborActions" default-sort="fecha" default-dir="asc" date-filter :auto-create="auto"
    :filters="[{ key: 'estado', label: 'Estado', options: EST }, { key: 'lote_id', label: 'Lote', lookup: 'lotes' }, { key: 'responsable_id', label: 'Responsable', lookup: 'trabajadoresTodos' }]" />
  <CrudView v-else-if="tab === 'riegos'" endpoint="/riegos" noun="riego" :write-perm="wr" :columns="riegoCols" :fields="riegoFields" default-sort="fecha" date-filter :auto-create="auto" :filters="[{ key: 'lote_id', label: 'Lote', lookup: 'lotes' }]" />
  <template v-else-if="tab === 'aplicaciones'">
    <div class="callout" style="margin-bottom:14px"><b>Registro, no recomendación.</b> CRM-Agro guarda lo que el encargado o la etiqueta del producto indican; <u>no calcula ni sugiere dosis</u> ni sustituye al ingeniero agrónomo. Respeta siempre el período de carencia.</div>
    <CrudView endpoint="/aplicaciones" noun="aplicación" plural="aplicaciones" :write-perm="wr" :columns="aplCols" :fields="aplFields" :row-actions="aplActions" :editable="false" date-filter :before-submit="aplBefore" :auto-create="auto" create-text="Registrar / programar aplicación" wide
      :filters="[{ key: 'estado', label: 'Estado', options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'aplicada', label: 'Aplicada' }, { value: 'cancelada', label: 'Cancelada' }] }, { key: 'carencia_vigente', label: 'Carencia', options: [{ value: '1', label: 'Solo vigentes' }] }, { key: 'lote_id', label: 'Lote', lookup: 'lotes' }]" />
  </template>
  <template v-else>
    <CrudView ref="crudCos" endpoint="/cosechas" noun="cosecha" :write-perm="wr" :columns="cosCols" :fields="cosFields" :row-actions="cosActions" default-sort="fecha" date-filter :before-submit="cosBefore" :auto-create="auto" create-text="Registrar cosecha"
      hint="Cada cosecha genera un lote de cosecha con código único y QR. No puede marcarse como comercializable si incumple un período de carencia registrado."
      :filters="[{ key: 'lote_id', label: 'Lote', lookup: 'lotes' }, { key: 'comercializable', label: 'Comercialización', options: [{ value: '1', label: 'Comercializable' }, { value: '0', label: 'Retenida' }] }]" />
    <FormModal v-if="invModal" :title="`Ingresar al inventario · ${invModal.codigo_lote_cosecha}`" submit-text="Ingresar" :on-submit="ingresar" @close="invModal = null"
      hint="Pendiente de ingresar: se usará el producto cosechado del cultivo (se crea si no existe)."
      :fields="[{ key: 'cantidad', label: `Cantidad a ingresar (${invModal.unidad})`, type: 'number', gt: 0, hint: `Vacío = todo lo pendiente (${fmtNum(invModal.cantidad - invModal.cantidad_inventariada)})` }, { key: 'costo_unitario', label: 'Costo unitario (opcional)', type: 'money', min: 0 }]" />
  </template>
</template>
