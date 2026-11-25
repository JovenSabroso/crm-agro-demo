<script setup>
import { ArrowUp, ArrowDown, Inbox, ChevronLeft, ChevronRight } from 'lucide-vue-next';
import { fmtDate, fmtMoney, fmtNum, badgeFor, labelize } from '../utils/format.js';
import { useAuth } from '../stores/auth.js';

/**
 * Tabla reutilizable. columns: [{ key, label, type?: 'text'|'money'|'num'|'date'|'badge'|'bool', sortable?, sortKey?, class?, format?(row) }]
 * Paginación y orden se delegan al padre mediante eventos (consulta a la API en el servidor).
 */
const props = defineProps({
  columns: { type: Array, required: true }, rows: { type: Array, default: () => [] }, loading: Boolean,
  meta: { type: Object, default: null }, sort: String, dir: String, emptyText: { type: String, default: 'No hay registros para mostrar.' }, rowKey: { type: String, default: 'id' },
});
const emit = defineEmits(['sort', 'page', 'row-click']);
const auth = useAuth();

function cell(row, c) {
  if (c.format) return c.format(row);
  const v = row[c.key];
  switch (c.type) {
    case 'money': return fmtMoney(v, auth.moneda);
    case 'num': return fmtNum(v);
    case 'date': return fmtDate(v);
    case 'bool': return v ? 'Sí' : 'No';
    case 'badge': return labelize(v ?? '—');
    default: return v ?? '—';
  }
}
const cls = (c) => [c.class, ['money', 'num'].includes(c.type) ? 'num' : ''];
function toggleSort(c) { if (!c.sortable) return; const k = c.sortKey || c.key; emit('sort', { sort: k, dir: props.sort === k && props.dir === 'asc' ? 'desc' : 'asc' }); }
</script>

<template>
  <div>
    <div class="table-wrap">
      <table class="t stack-sm">
        <thead>
          <tr>
            <th v-for="c in columns" :key="c.key" :class="[{ sortable: c.sortable }, ...cls(c)]" @click="toggleSort(c)" :aria-sort="sort === (c.sortKey || c.key) ? (dir === 'asc' ? 'ascending' : 'descending') : undefined">
              {{ c.label }}
              <template v-if="c.sortable && sort === (c.sortKey || c.key)"><ArrowUp v-if="dir === 'asc'" :size="12" /><ArrowDown v-else :size="12" /></template>
            </th>
            <th v-if="$slots.actions" />
          </tr>
        </thead>
        <tbody>
          <template v-if="loading && !rows.length"><tr v-for="i in 5" :key="i"><td v-for="c in columns" :key="c.key"><div class="skeleton" /></td><td v-if="$slots.actions" /></tr></template>
          <tr v-for="r in rows" :key="r[rowKey]" @click="emit('row-click', r)" :style="$attrs.onRowClick ? 'cursor:pointer' : ''">
            <td v-for="c in columns" :key="c.key" :data-label="c.label" :class="cls(c)">
              <slot :name="`cell-${c.key}`" :row="r" :value="r[c.key]">
                <span v-if="c.type === 'badge'" class="badge" :class="badgeFor(r[c.key])">{{ cell(r, c) }}</span>
                <template v-else>{{ cell(r, c) }}</template>
              </slot>
            </td>
            <td v-if="$slots.actions" class="actions" @click.stop><slot name="actions" :row="r" /></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!loading && !rows.length" class="empty"><Inbox :size="36" /><div>{{ emptyText }}</div></div>
    </div>
    <div v-if="meta && meta.total > 0" class="pager">
      <span>{{ (meta.page - 1) * meta.pageSize + 1 }}–{{ Math.min(meta.page * meta.pageSize, meta.total) }} de {{ meta.total }}</span>
      <div class="row">
        <button class="btn sm icon" :disabled="meta.page <= 1" aria-label="Página anterior" @click="emit('page', meta.page - 1)"><ChevronLeft :size="16" /></button>
        <span>Pág. {{ meta.page }} / {{ meta.totalPages }}</span>
        <button class="btn sm icon" :disabled="meta.page >= meta.totalPages" aria-label="Página siguiente" @click="emit('page', meta.page + 1)"><ChevronRight :size="16" /></button>
      </div>
    </div>
  </div>
</template>
