<script setup>
import { onMounted, reactive, ref, watch, computed } from 'vue';
import { Plus, Pencil, Trash2, Search } from 'lucide-vue-next';
import DataTable from './DataTable.vue';
import FormModal from './FormModal.vue';
import { api } from '../api/http.js';
import { useUi } from '../stores/ui.js';
import { useAuth } from '../stores/auth.js';
import { loadLookup, LK } from '../utils/lookups.js';

/** Vista CRUD genérica conectada a un endpoint REST: búsqueda, filtros, orden, paginación, crear/editar/eliminar con confirmación. */
const props = defineProps({
  endpoint: { type: String, required: true }, title: String, noun: { type: String, default: 'registro' },
  columns: { type: Array, required: true }, fields: { type: Array, default: () => [] },
  filters: { type: Array, default: () => [] }, writePerm: String, deletable: { type: Boolean, default: true }, editable: { type: Boolean, default: true },
  dateFilter: Boolean, defaultSort: { type: String, default: '' }, defaultDir: { type: String, default: 'desc' }, pageSize: { type: Number, default: 15 },
  rowActions: { type: Array, default: () => [] }, hint: String, autoCreate: Boolean, searchable: { type: Boolean, default: true },
  mapRow: Function, beforeSubmit: Function, wide: Boolean, query: { type: Object, default: () => ({}) }, createText: String, hideCreate: Boolean,
  emptyText: String, plural: String,
});
const emit = defineEmits(['changed', 'loaded']);
const ui = useUi(); const auth = useAuth();
const rows = ref([]); const meta = ref(null); const loading = ref(false); const modal = ref(null);
const q = reactive({ q: '', page: 1, sort: props.defaultSort, dir: props.defaultDir, desde: '', hasta: '' });
const fvals = reactive({}); const fopts = reactive({});
const canWrite = computed(() => auth.can(props.writePerm));

async function load() {
  loading.value = true;
  try {
    const params = { ...q, pageSize: props.pageSize, ...props.query, ...Object.fromEntries(Object.entries(fvals).filter(([, v]) => v !== '' && v !== null)) };
    const r = await api.list(props.endpoint, params);
    rows.value = r.data; meta.value = r.meta; emit('loaded', r);
  } catch (e) { ui.error(e); } finally { loading.value = false; }
}
let t; watch(() => q.q, () => { clearTimeout(t); t = setTimeout(() => { q.page = 1; load(); }, 300); });
watch(() => [q.desde, q.hasta, JSON.stringify(fvals), JSON.stringify(props.query)], () => { q.page = 1; load(); });
onMounted(async () => {
  for (const f of props.filters) { if (f.options) fopts[f.key] = f.options; else if (f.lookup) { const d = typeof f.lookup === 'string' ? LK[f.lookup] : f.lookup; loadLookup(d.endpoint, { params: d.params, label: d.label }).then(o => { fopts[f.key] = o; }).catch(() => {}); } fvals[f.key] = f.default ?? ''; }
  await load(); if (props.autoCreate && canWrite.value && !props.hideCreate) openCreate();
});

const openCreate = () => { modal.value = { mode: 'create', row: {} }; };
const openEdit = (row) => { modal.value = { mode: 'edit', row: props.mapRow ? props.mapRow(row) : row, id: row.id }; };
async function submit(payload) {
  const body = props.beforeSubmit ? props.beforeSubmit(payload, modal.value) : payload;
  const r = modal.value.mode === 'edit' ? await api.put(`${props.endpoint}/${modal.value.id}`, body) : await api.post(props.endpoint, body);
  ui.success(modal.value.mode === 'edit' ? `${cap(props.noun)} actualizado` : `${cap(props.noun)} registrado`);
  await load(); emit('changed', r); return r;
}
async function remove(row) {
  const ok = await ui.confirm({ title: `Eliminar ${props.noun}`, message: 'Esta acción no se puede deshacer.', confirmText: 'Eliminar', danger: true });
  if (!ok) return;
  try { await api.del(`${props.endpoint}/${row.id}`); ui.success(`${cap(props.noun)} eliminado`); await load(); emit('changed'); } catch (e) { ui.error(e); }
}
async function runAction(a, row) { try { await a.run(row, { reload: load, ui }); } catch (e) { ui.error(e); } }
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const sortBy = ({ sort, dir }) => { q.sort = sort; q.dir = dir; load(); };
const page = (p) => { q.page = p; load(); };
defineExpose({ reload: load, openCreate, rows });
</script>

<template>
  <div class="card">
    <div class="toolbar">
      <div v-if="searchable" class="field grow"><label class="sr-only">Buscar</label><div style="position:relative"><Search :size="16" style="position:absolute;left:12px;top:14px;color:var(--muted)" /><input class="input" style="padding-left:36px" v-model="q.q" :placeholder="`Buscar ${plural || noun + 's'}…`" type="search" /></div></div>
      <div v-for="f in filters" :key="f.key" class="field"><label>{{ f.label }}</label>
        <select class="input" v-model="fvals[f.key]"><option value="">Todos</option><option v-for="o in fopts[f.key] || []" :key="o.value" :value="o.value">{{ o.label }}</option></select></div>
      <template v-if="dateFilter"><div class="field"><label>Desde</label><input class="input" type="date" v-model="q.desde" /></div><div class="field"><label>Hasta</label><input class="input" type="date" v-model="q.hasta" /></div></template>
      <slot name="toolbar" />
      <button v-if="canWrite && !hideCreate && fields.length" class="btn primary" @click="openCreate"><Plus :size="18" />{{ createText || `Nuevo ${noun}` }}</button>
    </div>
    <DataTable :columns="columns" :rows="rows" :loading="loading" :meta="meta" :sort="q.sort" :dir="q.dir" :empty-text="emptyText" @sort="sortBy" @page="page">
      <template v-for="c in columns" :key="c.key" #[`cell-${c.key}`]="s"><slot :name="`cell-${c.key}`" v-bind="s" /></template>
      <template #actions="{ row }">
        <template v-for="a in rowActions" :key="a.label"><button v-if="!a.show || a.show(row)" class="btn sm" :class="a.class" :title="a.label" @click="runAction(a, row)"><component :is="a.icon" v-if="a.icon" :size="15" />{{ a.label }}</button>&nbsp;</template>
        <button v-if="canWrite && editable && fields.length" class="btn sm icon" aria-label="Editar" title="Editar" @click="openEdit(row)"><Pencil :size="15" /></button>&nbsp;
        <button v-if="canWrite && deletable" class="btn sm icon danger" aria-label="Eliminar" title="Eliminar" @click="remove(row)"><Trash2 :size="15" /></button>
      </template>
    </DataTable>
    <FormModal v-if="modal" :title="modal.mode === 'edit' ? `Editar ${noun}` : (createText || `Nuevo ${noun}`)" :fields="fields" :initial="modal.row" :wide="wide" :hint="hint" :on-submit="submit" @close="modal = null"><template #default="{ form }"><slot name="form-extra" :form="form" /></template></FormModal>
  </div>
</template>
