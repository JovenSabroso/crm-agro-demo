<script setup>
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import PageHead from '../components/PageHead.vue';
import TabBar from '../components/TabBar.vue';
import CrudView from '../components/CrudView.vue';
import { api } from '../api/http.js';
import { useUi } from '../stores/ui.js';
import { useAuth } from '../stores/auth.js';
import { today, fmtNum } from '../utils/format.js';

const route = useRoute(); const ui = useUi(); const auth = useAuth();
const tabs = [{ key: 'lista', label: 'Trabajadores' }, { key: 'asistencia', label: 'Asistencia' }, { key: 'tareas', label: 'Tareas' }, { key: 'jornales', label: 'Jornales' }, { key: 'anticipos', label: 'Anticipos' }, { key: 'pagos', label: 'Pagos' }];
const tab = ref(tabs.find(t => t.key === route.query.tab)?.key || 'lista');
const W = 'trabajadores:write', P = 'pagos:write';
const canPay = auth.can(P);
const ESTADOS = ['activo', 'inactivo', 'suspendido'].map(v => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));

const trabCols = [{ key: 'nombre', label: 'Nombre', sortable: true }, { key: 'cargo', label: 'Cargo', sortable: true }, { key: 'telefono', label: 'Teléfono' }, { key: 'tarifa_jornal', label: 'Jornal', type: 'money', sortable: true, sortKey: 'tarifa' }, { key: 'estado', label: 'Estado', type: 'badge' }];
const trabFields = [{ key: 'nombre', label: 'Nombre completo', required: true }, { key: 'documento', label: 'Documento (CI)' }, { key: 'telefono', label: 'Teléfono' }, { key: 'cargo', label: 'Cargo o función' }, { key: 'tarifa_jornal', label: 'Tarifa por jornal', type: 'money', min: 0, default: 0 },
  { key: 'estado', label: 'Estado laboral', type: 'select', options: ESTADOS, required: true, default: 'activo' }, { key: 'fecha_ingreso', label: 'Fecha de ingreso', type: 'date' }, { key: 'consentimiento_datos', label: 'Consentimiento para el tratamiento de sus datos', type: 'checkbox', full: true }, { key: 'observaciones', label: 'Observaciones', type: 'textarea' }];
const tareaCols = [{ key: 'fecha', label: 'Fecha', type: 'date', sortable: true }, { key: 'trabajador_nombre', label: 'Trabajador' }, { key: 'titulo', label: 'Tarea' }, { key: 'estado', label: 'Estado', type: 'badge' }];
const EST = [{ value: 'pendiente', label: 'Pendiente' }, { value: 'en_curso', label: 'En curso' }, { value: 'completada', label: 'Completada' }, { value: 'cancelada', label: 'Cancelada' }];
const tareaFields = [{ key: 'trabajador_id', label: 'Trabajador', type: 'select', lookup: 'trabajadores', required: true }, { key: 'titulo', label: 'Tarea', required: true }, { key: 'fecha', label: 'Fecha', type: 'date', required: true, default: today }, { key: 'estado', label: 'Estado', type: 'select', options: EST, required: true, default: 'pendiente' }, { key: 'descripcion', label: 'Descripción', type: 'textarea' }];
const jorCols = [{ key: 'fecha', label: 'Fecha', type: 'date' }, { key: 'trabajador_nombre', label: 'Trabajador' }, { key: 'lote_nombre', label: 'Lote' }, { key: 'tipo', label: 'Tipo' }, { key: 'jornadas', label: 'Jornadas', type: 'num' }, { key: 'monto', label: 'Monto', type: 'money' }, { key: 'pagado', label: 'Pago', format: r => (r.pago_id ? 'Pagado' : 'Pendiente') }];
const jorFields = [{ key: 'trabajador_id', label: 'Trabajador', type: 'select', lookup: 'trabajadores', required: true }, { key: 'fecha', label: 'Fecha', type: 'date', required: true, default: today }, { key: 'jornadas', label: 'Jornadas (1 = día completo, 0.5 = medio)', type: 'number', gt: 0, max: 3, required: true, default: 1 },
  { key: 'lote_id', label: 'Lote', type: 'select', lookup: 'lotes' }, { key: 'tipo', label: 'Tipo', type: 'select', required: true, default: 'campo', options: ['campo', 'cosecha', 'vivero', 'otro'].map(v => ({ value: v, label: v })) }, { key: 'tarifa', label: 'Tarifa (vacío = la del trabajador)', type: 'money', min: 0 }];
const antCols = [{ key: 'fecha', label: 'Fecha', type: 'date' }, { key: 'trabajador_nombre', label: 'Trabajador' }, { key: 'monto', label: 'Monto', type: 'money' }, { key: 'motivo', label: 'Motivo' }, { key: 'descontado', label: 'Estado', format: r => (r.pago_id ? 'Descontado' : 'Pendiente') }];
const antFields = [{ key: 'trabajador_id', label: 'Trabajador', type: 'select', lookup: 'trabajadores', required: true }, { key: 'fecha', label: 'Fecha', type: 'date', required: true, default: today }, { key: 'monto', label: 'Monto', type: 'money', gt: 0, required: true }, { key: 'motivo', label: 'Motivo' }];
const pagoCols = [{ key: 'fecha', label: 'Fecha', type: 'date' }, { key: 'trabajador_nombre', label: 'Trabajador' }, { key: 'periodo', label: 'Período', format: r => `${r.periodo_desde} → ${r.periodo_hasta}` }, { key: 'bruto', label: 'Bruto', type: 'money' }, { key: 'anticipos_descontados', label: 'Anticipos', type: 'money' }, { key: 'neto', label: 'Neto pagado', type: 'money' }];
const pagoFields = [{ key: 'trabajador_id', label: 'Trabajador', type: 'select', lookup: 'trabajadores', required: true }, { key: 'periodo_desde', label: 'Desde', type: 'date', required: true }, { key: 'periodo_hasta', label: 'Hasta', type: 'date', required: true, default: today },
  { key: 'metodo', label: 'Método', default: 'efectivo', required: true }, { key: 'descontar_anticipos', label: 'Descontar anticipos pendientes', type: 'checkbox', default: true }];

// Asistencia (planilla del día)
const fecha = ref(today()); const planilla = ref([]); const resumen = ref(null); const saving = ref(false);
async function loadPlanilla() { try { [planilla.value, resumen.value] = await Promise.all([api.get('/asistencia/dia', { fecha: fecha.value }), api.get('/asistencia/resumen', { fecha: fecha.value })]); planilla.value = planilla.value.map(p => ({ ...p, estado: p.estado || '', justificacion: p.justificacion || '' })); } catch (e) { ui.error(e); } }
async function guardarPlanilla() {
  const registros = planilla.value.filter(p => p.estado).map(p => ({ trabajador_id: p.trabajador_id, estado: p.estado, justificacion: p.justificacion || null }));
  if (!registros.length) return ui.warn('Marca la asistencia de al menos un trabajador.');
  saving.value = true; try { await api.post('/asistencia/lote', { fecha: fecha.value, registros }); ui.success('Asistencia guardada'); loadPlanilla(); } catch (e) { ui.error(e); } finally { saving.value = false; }
}
const marcarTodos = (e) => planilla.value.forEach(p => { p.estado = e; });
watch(fecha, loadPlanilla); onMounted(() => { if (tab.value === 'asistencia') loadPlanilla(); }); watch(tab, t => { if (t === 'asistencia') loadPlanilla(); });
</script>

<template>
  <PageHead title="Trabajadores" subtitle="Registro, asistencia, tareas, jornales, anticipos y pagos." />
  <TabBar v-model="tab" :tabs="tabs.filter(t => !['jornales', 'anticipos', 'pagos'].includes(t.key) || canPay || true)" />

  <CrudView v-if="tab === 'lista'" endpoint="/trabajadores" noun="trabajador" :write-perm="W" :columns="trabCols" :fields="trabFields" default-sort="nombre" default-dir="asc" :filters="[{ key: 'estado', label: 'Estado', options: ESTADOS }]"
    hint="Los trabajadores con historial no se eliminan: márcalos como inactivos." />
  <div v-else-if="tab === 'asistencia'" class="card">
    <div class="toolbar"><div class="field"><label>Fecha</label><input class="input" type="date" v-model="fecha" /></div>
      <div v-if="resumen" class="row"><span class="badge ok">Presentes {{ resumen.presentes }}</span><span class="badge warn">Retrasos {{ resumen.retrasos }}</span><span class="badge danger">Ausentes {{ resumen.ausentes }}</span><span class="badge">Sin registro {{ resumen.sin_registro }}</span></div>
      <button v-if="auth.can(W)" class="btn" @click="marcarTodos('presente')">Todos presentes</button><button v-if="auth.can(W)" class="btn primary" :disabled="saving" @click="guardarPlanilla"><span v-if="saving" class="spinner" />Guardar asistencia</button></div>
    <div class="table-wrap"><table class="t stack-sm"><thead><tr><th>Trabajador</th><th>Cargo</th><th>Estado</th><th>Justificación</th></tr></thead><tbody>
      <tr v-for="p in planilla" :key="p.trabajador_id"><td data-label="Trabajador"><b>{{ p.nombre }}</b></td><td data-label="Cargo">{{ p.cargo || '—' }}</td>
        <td data-label="Estado"><select class="input" v-model="p.estado" :disabled="!auth.can(W)"><option value="">Sin registrar</option><option value="presente">Presente</option><option value="retraso">Retraso</option><option value="ausente">Ausente</option></select></td>
        <td data-label="Justificación"><input class="input" v-model="p.justificacion" placeholder="Opcional" :disabled="!auth.can(W)" /></td></tr></tbody></table><div v-if="!planilla.length" class="empty">No hay trabajadores activos.</div></div>
  </div>
  <CrudView v-else-if="tab === 'tareas'" endpoint="/tareas" noun="tarea" :write-perm="W" :columns="tareaCols" :fields="tareaFields" default-sort="fecha" date-filter :filters="[{ key: 'trabajador_id', label: 'Trabajador', lookup: 'trabajadoresTodos' }, { key: 'estado', label: 'Estado', options: EST }]" />
  <CrudView v-else-if="tab === 'jornales'" endpoint="/jornales" noun="jornal" :write-perm="P" :columns="jorCols" :fields="jorFields" :editable="false" default-sort="fecha" date-filter :filters="[{ key: 'trabajador_id', label: 'Trabajador', lookup: 'trabajadoresTodos' }, { key: 'pagado', label: 'Pago', options: [{ value: '0', label: 'Pendientes' }, { value: '1', label: 'Pagados' }] }]" hint="Monto = jornadas × tarifa. No se permiten jornales duplicados (mismo trabajador, fecha y lote)." />
  <CrudView v-else-if="tab === 'anticipos'" endpoint="/anticipos" noun="anticipo" :write-perm="P" :columns="antCols" :fields="antFields" :editable="false" date-filter :filters="[{ key: 'trabajador_id', label: 'Trabajador', lookup: 'trabajadoresTodos' }]" />
  <CrudView v-else endpoint="/pagos" noun="pago" :write-perm="P" :columns="pagoCols" :fields="pagoFields" :editable="false" date-filter create-text="Registrar pago" :filters="[{ key: 'trabajador_id', label: 'Trabajador', lookup: 'trabajadoresTodos' }]"
    hint="El pago suma los jornales pendientes del período y descuenta anticipos; no permite pagar dos veces el mismo jornal. Eliminar = anular el pago." />
</template>
