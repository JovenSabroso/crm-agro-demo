<script setup>
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Sprout, Sprout as Sp, ShoppingCart, DollarSign } from 'lucide-vue-next';
import PageHead from '../components/PageHead.vue';
import TabBar from '../components/TabBar.vue';
import CrudView from '../components/CrudView.vue';
import FormModal from '../components/FormModal.vue';
import StatCard from '../components/StatCard.vue';
import { api } from '../api/http.js';
import { useUi } from '../stores/ui.js';
import { useAuth } from '../stores/auth.js';
import { fmtNum, fmtMoney, today } from '../utils/format.js';

const route = useRoute(); const ui = useUi(); const auth = useAuth();
const tabs = [{ key: 'siembras', label: 'Siembras y plantines' }, { key: 'especies', label: 'Especies y variedades' }, { key: 'viveros', label: 'Viveros' }, { key: 'historial', label: 'Historial de producción' }];
const tab = ref(tabs.find(t => t.key === route.query.tab)?.key || 'siembras');
const W = 'vivero:write'; const res = ref(null); const crud = ref(null); const modal = ref(null);
async function loadRes() { try { res.value = await api.get('/vivero/resumen'); } catch (e) { ui.error(e); } }
onMounted(loadRes);
const refresh = () => { loadRes(); crud.value?.reload(); };

const sCols = [{ key: 'codigo', label: 'Código' }, { key: 'especie_nombre', label: 'Especie', format: r => `${r.especie_nombre} ${r.especie_variedad || ''}` }, { key: 'fecha_siembra', label: 'Siembra', type: 'date' }, { key: 'cantidad_sembrada', label: 'Sembrados', type: 'num' }, { key: 'germinadas', label: 'Germinados', type: 'num' }, { key: 'perdidas', label: 'Pérdidas', type: 'num' }, { key: 'vendidas', label: 'Vendidos', type: 'num' }, { key: 'disponibles', label: 'Disponibles', type: 'num' }, { key: 'tasa_germinacion', label: 'Germ. %', type: 'num' }, { key: 'costo_produccion', label: 'Costo', type: 'money' }, { key: 'estado', label: 'Estado', type: 'badge' }];
const sFields = [{ key: 'vivero_id', label: 'Vivero', type: 'select', lookup: 'viveros', required: true }, { key: 'especie_id', label: 'Especie / variedad', type: 'select', lookup: 'especies', required: true }, { key: 'fecha_siembra', label: 'Fecha de siembra', type: 'date', required: true, default: today }, { key: 'cantidad_sembrada', label: 'Cantidad sembrada', type: 'number', gt: 0, required: true }, { key: 'codigo', label: 'Código (opcional)' }, { key: 'observaciones', label: 'Observaciones', type: 'textarea' }];
const MOV = [{ value: 'germinacion', label: 'Germinación' }, { value: 'crecimiento', label: 'Control de crecimiento' }, { value: 'perdida', label: 'Pérdida' }, { value: 'trasplante', label: 'Trasplante a campo' }];
const sActions = [
  { label: 'Movimiento', run: (r) => { modal.value = { kind: 'mov', r }; } }, { label: 'Costo', run: (r) => { modal.value = { kind: 'costo', r }; } },
  { label: 'Vender', icon: ShoppingCart, show: r => r.disponibles > 0 && auth.hasModule('M5') && auth.can('ventas:write'), run: (r) => { modal.value = { kind: 'vender', r }; } },
];
const mFields = [{ key: 'tipo', label: 'Tipo', type: 'select', options: MOV, required: true, default: 'germinacion' }, { key: 'cantidad', label: 'Cantidad de plantines', type: 'number', min: 0, default: 0, showIf: f => f.tipo !== 'crecimiento' }, { key: 'altura_cm', label: 'Altura (cm)', type: 'number', min: 0, showIf: f => f.tipo === 'crecimiento', required: true }, { key: 'fecha', label: 'Fecha', type: 'date', default: today }, { key: 'observaciones', label: 'Observaciones' }];
const cFields = [{ key: 'fecha', label: 'Fecha', type: 'date', required: true, default: today }, { key: 'descripcion', label: 'Descripción del costo', required: true }, { key: 'monto', label: 'Monto', type: 'money', gt: 0, required: true }];
const vFields = (r) => [{ key: 'cliente_id', label: 'Cliente', type: 'select', lookup: 'clientes', required: true }, { key: 'cantidad', label: `Cantidad (disponibles ${r.disponibles})`, type: 'number', gt: 0, max: r.disponibles, required: true }, { key: 'precio_unitario', label: 'Precio unitario', type: 'money', min: 0, default: r.precio_plantin ?? '' }, { key: 'metodo_pago', label: 'Pago', type: 'select', default: 'efectivo', options: [{ value: 'efectivo', label: 'Efectivo' }, { value: 'transferencia', label: 'Transferencia' }, { value: 'qr', label: 'QR' }, { value: 'credito', label: 'Crédito' }] }];
async function sub(p) {
  const { kind, r } = modal.value;
  if (kind === 'mov') await api.post(`/vivero/siembras/${r.id}/movimientos`, { ...p, cantidad: p.cantidad ?? 0 });
  else if (kind === 'costo') await api.post(`/vivero/siembras/${r.id}/costos`, p);
  else await api.post(`/vivero/siembras/${r.id}/vender`, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null)));
  ui.success('Registrado'); refresh();
}
const espCols = [{ key: 'nombre', label: 'Especie' }, { key: 'variedad', label: 'Variedad' }, { key: 'tipo', label: 'Tipo' }, { key: 'dias_germinacion', label: 'Días germinación', type: 'num' }, { key: 'precio_plantin', label: 'Precio plantín', type: 'money' }];
const espFields = [{ key: 'nombre', label: 'Especie', required: true }, { key: 'variedad', label: 'Variedad' }, { key: 'tipo', label: 'Tipo (hortaliza, frutal…)' }, { key: 'dias_germinacion', label: 'Días de germinación', type: 'number', min: 1 }, { key: 'precio_plantin', label: 'Precio de venta por plantín', type: 'money', min: 0 }];
const vivCols = [{ key: 'nombre', label: 'Vivero' }, { key: 'ubicacion', label: 'Ubicación' }]; const vivFields = [{ key: 'nombre', label: 'Nombre', required: true }, { key: 'ubicacion', label: 'Ubicación' }];
const movCols = [{ key: 'fecha', label: 'Fecha', type: 'date' }, { key: 'siembra_codigo', label: 'Siembra' }, { key: 'especie_nombre', label: 'Especie' }, { key: 'tipo', label: 'Movimiento', type: 'badge' }, { key: 'cantidad', label: 'Cantidad', type: 'num' }, { key: 'altura_cm', label: 'Altura (cm)', type: 'num' }];
</script>

<template>
  <PageHead title="Vivero" subtitle="Producción de plantines: siembra, germinación, pérdidas, stock, costos y ventas." />
  <div v-if="res" class="grid g4 keep2" style="margin-bottom:16px"><StatCard label="Plantines germinados" :value="fmtNum(res.germinadas)" :sub="`${fmtNum(res.sembradas)} sembrados`" :icon="Sprout" /><StatCard label="Disponibles" :value="fmtNum(res.disponibles)" :sub="`${fmtNum(res.existentes)} existentes`" :icon="Sp" tone="teal" /><StatCard label="Vendidos" :value="fmtNum(res.vendidas)" :sub="`Pérdidas ${fmtNum(res.perdidas)}`" :icon="ShoppingCart" tone="amber" /><StatCard label="Ingresos / costos" :value="fmtMoney(res.ingresos, auth.moneda)" :sub="`Costo producción ${fmtMoney(res.costo_produccion, auth.moneda)}`" :icon="DollarSign" /></div>
  <TabBar v-model="tab" :tabs="tabs" />
  <CrudView v-if="tab === 'siembras'" ref="crud" endpoint="/vivero/siembras" noun="siembra" :write-perm="W" :columns="sCols" :fields="sFields" :editable="false" :row-actions="sActions" create-text="Registrar siembra" date-filter default-sort="fecha_siembra" @changed="loadRes" :auto-create="route.query.nueva === '1'" />
  <CrudView v-else-if="tab === 'especies'" endpoint="/especies" noun="especie" :write-perm="W" :columns="espCols" :fields="espFields" default-sort="nombre" default-dir="asc" />
  <CrudView v-else-if="tab === 'viveros'" endpoint="/viveros" noun="vivero" :write-perm="W" :columns="vivCols" :fields="vivFields" default-sort="nombre" default-dir="asc" />
  <CrudView v-else endpoint="/vivero/movimientos" noun="movimiento" plural="movimientos" :write-perm="W" :columns="movCols" :fields="[]" :deletable="false" hide-create date-filter default-sort="fecha" :filters="[{ key: 'tipo', label: 'Tipo', options: MOV }]" />
  <FormModal v-if="modal" :title="`${modal.kind === 'mov' ? 'Movimiento' : modal.kind === 'costo' ? 'Costo de producción' : 'Vender plantines'} · ${modal.r.codigo}`" :fields="modal.kind === 'mov' ? mFields : modal.kind === 'costo' ? cFields : vFields(modal.r)" :on-submit="sub" @close="modal = null" />
</template>
