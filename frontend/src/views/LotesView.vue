<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import PageHead from '../components/PageHead.vue';
import TabBar from '../components/TabBar.vue';
import CrudView from '../components/CrudView.vue';
import MapView from '../components/MapView.vue';
import { api } from '../api/http.js';
import { useAuth } from '../stores/auth.js';
import { fmtNum, fmtDate } from '../utils/format.js';
import { clearLookups } from '../utils/lookups.js';

const route = useRoute(); const auth = useAuth();
const tabs = [{ key: 'lotes', label: 'Lotes' }, { key: 'plantaciones', label: 'Cultivos en lote' }, { key: 'cultivos', label: 'Catálogo de cultivos' }, { key: 'campanas', label: 'Campañas' }];
const tab = ref(tabs.find(t => t.key === route.query.tab)?.key || 'lotes');
const resumen = ref([]); const crud = ref(null);
async function loadResumen() { resumen.value = await api.get('/lotes/resumen'); }
onMounted(loadResumen);
const changed = () => { clearLookups(); loadResumen(); };
const markers = computed(() => resumen.value.filter(l => l.latitud != null).map(l => ({ lat: l.latitud, lng: l.longitud, label: `${l.codigo} · ${l.nombre}${l.cultivo ? ' — ' + l.cultivo : ''}`, color: l.cultivo ? '#2f7a47' : '#9aa59c' })));

const ESTADO_LOTE = [{ value: 'activo', label: 'Activo' }, { value: 'descanso', label: 'En descanso' }, { value: 'inactivo', label: 'Inactivo' }];
const loteCols = [{ key: 'codigo', label: 'Código', sortable: true }, { key: 'nombre', label: 'Nombre', sortable: true }, { key: 'superficie_ha', label: 'Superficie (ha)', type: 'num', sortable: true }, { key: 'tipo_suelo', label: 'Suelo' }, { key: 'estado', label: 'Estado', type: 'badge' }];
const loteFields = [
  { key: 'codigo', label: 'Código', required: true, placeholder: 'L1' }, { key: 'nombre', label: 'Nombre', required: true }, { key: 'superficie_ha', label: 'Superficie (ha)', type: 'number', min: 0 },
  { key: 'tipo_suelo', label: 'Tipo de suelo' }, { key: 'estado', label: 'Estado', type: 'select', options: ESTADO_LOTE, required: true, default: 'activo' },
  { key: 'latitud', label: 'Latitud', type: 'number', min: -90, max: 90, hint: 'Opcional. También puedes tocar el mapa.' }, { key: 'longitud', label: 'Longitud', type: 'number', min: -180, max: 180 }, { key: 'observaciones', label: 'Observaciones', type: 'textarea' },
];
const pickPoint = (form, p) => { form.latitud = p.lat; form.longitud = p.lng; };

const cultivoCols = [{ key: 'nombre', label: 'Cultivo', sortable: true }, { key: 'variedad', label: 'Variedad' }, { key: 'tipo', label: 'Tipo', type: 'badge' }, { key: 'ciclo_dias', label: 'Ciclo (días)', type: 'num' }, { key: 'unidad_cosecha', label: 'Unidad de cosecha' }];
const cultivoFields = [{ key: 'nombre', label: 'Cultivo', required: true }, { key: 'variedad', label: 'Variedad' },
  { key: 'tipo', label: 'Tipo', type: 'select', required: true, default: 'hortaliza', options: ['hortaliza', 'fruta', 'cereal', 'tuberculo', 'forraje', 'otro'].map(v => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
  { key: 'ciclo_dias', label: 'Ciclo aproximado (días)', type: 'number', min: 1 }, { key: 'unidad_cosecha', label: 'Unidad de cosecha', required: true, default: 'kg', hint: 'kg, cajas, unidades…' }];
const ESTADO_CAMP = [{ value: 'planificada', label: 'Planificada' }, { value: 'activa', label: 'Activa' }, { value: 'cerrada', label: 'Cerrada' }];
const campCols = [{ key: 'nombre', label: 'Campaña', sortable: true }, { key: 'fecha_inicio', label: 'Inicio', type: 'date', sortable: true }, { key: 'fecha_fin', label: 'Fin', type: 'date' }, { key: 'estado', label: 'Estado', type: 'badge' }];
const campFields = [{ key: 'nombre', label: 'Nombre', required: true, placeholder: 'Campaña 2026-2027' }, { key: 'fecha_inicio', label: 'Inicio', type: 'date', required: true }, { key: 'fecha_fin', label: 'Fin', type: 'date' }, { key: 'estado', label: 'Estado', type: 'select', options: ESTADO_CAMP, required: true, default: 'activa' }, { key: 'observaciones', label: 'Observaciones', type: 'textarea' }];
const ESTADO_PL = [{ value: 'activo', label: 'Activo (en campo)' }, { value: 'cosechado', label: 'Cosechado' }, { value: 'cerrado', label: 'Cerrado' }];
const plCols = [{ key: 'lote', label: 'Lote', format: r => `${r.lote_codigo} · ${r.lote_nombre}`, sortable: true, sortKey: 'lote' }, { key: 'cultivo', label: 'Cultivo', format: r => r.cultivo_variedad ? `${r.cultivo_nombre} ${r.cultivo_variedad}` : r.cultivo_nombre, sortable: true, sortKey: 'cultivo' },
  { key: 'campana_nombre', label: 'Campaña' }, { key: 'fecha_siembra', label: 'Siembra', type: 'date', sortable: true }, { key: 'fecha_cosecha_estimada', label: 'Cosecha estimada', type: 'date' }, { key: 'estado', label: 'Estado', type: 'badge' }];
const plFields = [{ key: 'lote_id', label: 'Lote', type: 'select', lookup: 'lotes', required: true, lockOnEdit: true }, { key: 'cultivo_id', label: 'Cultivo', type: 'select', lookup: 'cultivos', required: true, lockOnEdit: true },
  { key: 'campana_id', label: 'Campaña', type: 'select', lookup: 'campanas' }, { key: 'fecha_siembra', label: 'Fecha de siembra', type: 'date', required: true }, { key: 'fecha_cosecha_estimada', label: 'Cosecha estimada', type: 'date' },
  { key: 'estado', label: 'Estado', type: 'select', options: ESTADO_PL, required: true, default: 'activo' }, { key: 'observaciones', label: 'Observaciones', type: 'textarea' }];
</script>

<template>
  <PageHead title="Lotes y cultivos" subtitle="Terrenos de la finca, cultivos establecidos y campañas agrícolas." />
  <TabBar v-model="tab" :tabs="tabs" />

  <template v-if="tab === 'lotes'">
    <div class="card card-pad" style="margin-bottom:16px"><h3 style="margin-bottom:10px">Mapa de lotes</h3><MapView :markers="markers" /><p class="muted small" style="margin:8px 0 0">Verde: lote con cultivo activo · Gris: sin cultivo. Los lotes aparecen al registrar su latitud/longitud.</p></div>
    <CrudView ref="crud" endpoint="/lotes" noun="lote" write-perm="lotes:write" :columns="loteCols" :fields="loteFields" default-sort="codigo" default-dir="asc" :filters="[{ key: 'estado', label: 'Estado', options: ESTADO_LOTE }]" @changed="changed" :auto-create="route.query.nueva === '1'">
      <template #form-extra="{ form }"><div style="margin-top:14px"><MapView pick :point="form.latitud != null && form.latitud !== '' ? { lat: Number(form.latitud), lng: Number(form.longitud) } : null" @update:point="pickPoint(form, $event)" /><div class="hint small" style="margin-top:4px">Toca el mapa para fijar la ubicación del lote.</div></div></template>
    </CrudView>
  </template>
  <CrudView v-else-if="tab === 'plantaciones'" endpoint="/plantaciones" noun="cultivo en lote" plural="cultivos en lote" write-perm="lotes:write" :columns="plCols" :fields="plFields" default-sort="fecha_siembra" create-text="Sembrar cultivo en un lote"
    :filters="[{ key: 'estado', label: 'Estado', options: ESTADO_PL }, { key: 'lote_id', label: 'Lote', lookup: 'lotes' }]" hint="Un lote solo puede tener un cultivo activo a la vez. Marca el anterior como cosechado o cerrado antes de sembrar otro." @changed="changed" :auto-create="route.query.nueva === '1'" />
  <CrudView v-else-if="tab === 'cultivos'" endpoint="/cultivos" noun="cultivo" write-perm="lotes:write" :columns="cultivoCols" :fields="cultivoFields" default-sort="nombre" default-dir="asc" @changed="changed" />
  <CrudView v-else endpoint="/campanas" noun="campaña" write-perm="lotes:write" :columns="campCols" :fields="campFields" default-sort="fecha_inicio" @changed="changed" />
</template>
