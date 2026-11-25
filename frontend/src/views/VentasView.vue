<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Plus, Trash2, X, Printer, Ban, HandCoins, ArrowRightLeft } from 'lucide-vue-next';
import PageHead from '../components/PageHead.vue';
import TabBar from '../components/TabBar.vue';
import CrudView from '../components/CrudView.vue';
import FormModal from '../components/FormModal.vue';
import { api, openFile } from '../api/http.js';
import { useUi } from '../stores/ui.js';
import { useAuth } from '../stores/auth.js';
import { loadLookup, LK } from '../utils/lookups.js';
import { METODOS_PAGO, fmtMoney, fmtNum, today, fmtDate } from '../utils/format.js';

const route = useRoute(); const ui = useUi(); const auth = useAuth();
const tabs = [{ key: 'ventas', label: 'Ventas' }, { key: 'pedidos', label: 'Pedidos' }, { key: 'cxc', label: 'Cuentas por cobrar' }, { key: 'clientes', label: 'Clientes' }, { key: 'transacciones', label: 'Transacciones' }];
const tab = ref(tabs.find(t => t.key === route.query.tab)?.key || 'ventas');
const W = 'ventas:write'; const M = (v) => fmtMoney(v, auth.moneda);
const crud = ref(null);

// ----- Formulario de venta / pedido -----
const modo = ref(null);  // 'venta' | 'pedido'
const clientes = ref([]); const productos = ref([]); const siembras = ref([]); const saving = ref(false); const error = ref('');
const f = reactive({ cliente_id: '', metodo_pago: 'efectivo', fecha: today(), fecha_vencimiento: '', monto_pagado: '', observaciones: '', items: [] });
const hasM6 = auth.hasModule('M6');
async function abrir(m) {
  modo.value = m; error.value = ''; Object.assign(f, { cliente_id: '', metodo_pago: 'efectivo', fecha: today(), fecha_vencimiento: '', monto_pagado: '', observaciones: '', items: [{ ref: '', cantidad: 1, precio_unitario: '', descuento: 0 }] });
  try {
    clientes.value = await loadLookup(LK.clientes.endpoint, { label: LK.clientes.label, force: true });
    productos.value = await loadLookup('/productos', { params: { activo: 1, con_stock: m === 'venta' ? 1 : '' }, label: r => `${r.nombre} · ${fmtNum(r.stock_actual)} ${r.unidad}`, force: true });
    if (hasM6 && m === 'venta') siembras.value = await loadLookup('/vivero/siembras', { label: r => `Plantines ${r.especie_nombre} (${r.codigo}) · disp. ${r.disponibles}`, force: true }).then(a => a.filter(s => s.raw.disponibles > 0));
  } catch (e) { ui.error(e); }
}
const pick = (it) => { const [k, id] = String(it.ref).split(':'); const src = k === 'p' ? productos.value.find(p => p.value === +id) : siembras.value.find(s => s.value === +id); if (src) it.precio_unitario = (k === 'p' ? src.raw.precio_venta : src.raw.precio_plantin) ?? ''; };
const sub = (it) => Math.max(0, (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0) - (Number(it.descuento) || 0));
const total = computed(() => f.items.reduce((s, it) => s + sub(it), 0));
async function guardar() {
  error.value = '';
  if (!f.cliente_id) return (error.value = 'Selecciona un cliente.');
  const items = f.items.filter(i => i.ref).map(i => { const [k, id] = i.ref.split(':'); return { [k === 'p' ? 'producto_id' : 'siembra_id']: +id, cantidad: Number(i.cantidad), precio_unitario: i.precio_unitario === '' ? undefined : Number(i.precio_unitario), descuento: Number(i.descuento) || 0 }; });
  if (!items.length) return (error.value = 'Agrega al menos un producto.');
  saving.value = true;
  try {
    if (modo.value === 'venta') { const v = await api.post('/ventas', { cliente_id: +f.cliente_id, fecha: f.fecha, metodo_pago: f.metodo_pago, fecha_vencimiento: f.fecha_vencimiento || undefined, monto_pagado: f.monto_pagado === '' ? undefined : Number(f.monto_pagado), observaciones: f.observaciones || undefined, items: items.filter(i => i.producto_id || i.siembra_id) }); ui.success(`Venta ${v.numero} registrada. Inventario actualizado.`); }
    else { await api.post('/pedidos', { cliente_id: +f.cliente_id, fecha: f.fecha, observaciones: f.observaciones || undefined, items: items.map(({ producto_id, cantidad, precio_unitario }) => ({ producto_id, cantidad, precio_unitario })) }); ui.success('Pedido registrado'); }
    modo.value = null; crud.value?.reload();
  } catch (e) { error.value = e.message + (e.details?.length ? ' — ' + e.details.map(d => `${d.campo}: ${d.mensaje}`).join('; ') : ''); } finally { saving.value = false; }
}

// ----- columnas -----
const ventaCols = [{ key: 'numero', label: 'N.º', sortable: true }, { key: 'fecha', label: 'Fecha', type: 'date', sortable: true }, { key: 'cliente_nombre', label: 'Cliente', sortable: true, sortKey: 'cliente' }, { key: 'total', label: 'Total', type: 'money', sortable: true }, { key: 'saldo', label: 'Saldo', type: 'money' }, { key: 'metodo_pago', label: 'Pago' }, { key: 'estado', label: 'Estado', type: 'badge' }];
const detalle = ref(null); const pagoModal = ref(null);
const ventaActions = [
  { label: 'Detalle', run: async (r) => { detalle.value = await api.get(`/ventas/${r.id}`); } },
  { label: 'Comprobante', icon: Printer, run: (r) => openFile(`/ventas/${r.id}/comprobante.pdf`) },
  { label: 'Cobrar', icon: HandCoins, show: r => r.estado === 'confirmada' && r.saldo > 0, run: (r) => { pagoModal.value = r; } },
  { label: 'Confirmar', show: r => r.estado === 'borrador', run: async (r, { reload }) => { await api.post(`/ventas/${r.id}/confirmar`, {}); ui.success('Venta confirmada'); reload(); } },
  { label: 'Anular', icon: Ban, class: 'danger', show: r => r.estado !== 'anulada', run: async (r, { reload }) => { if (!(await ui.confirm({ title: `Anular venta ${r.numero}`, message: 'Se devolverá el stock al inventario y se cancelará la cuenta por cobrar.', danger: true, confirmText: 'Anular venta' }))) return; await api.post(`/ventas/${r.id}/anular`, { motivo: 'Anulada por el usuario' }); ui.success('Venta anulada'); reload(); } },
];
const cobrar = async (p) => { await api.post(`/ventas/${pagoModal.value.id}/pagos`, p); ui.success('Cobro registrado'); crud.value?.reload(); };
const pedCols = [{ key: 'fecha', label: 'Fecha', type: 'date' }, { key: 'cliente_nombre', label: 'Cliente' }, { key: 'fecha_entrega', label: 'Entrega', type: 'date' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'estado', label: 'Estado', type: 'badge' }];
const pedActions = [{ label: 'Convertir en venta', icon: ArrowRightLeft, show: r => ['pendiente', 'confirmado'].includes(r.estado), run: async (r, { reload }) => { if (!(await ui.confirm({ title: 'Convertir pedido en venta', message: 'Se descontará el inventario (lotes más antiguos primero).', confirmText: 'Convertir' }))) return; const v = await api.post(`/pedidos/${r.id}/convertir`, { metodo_pago: 'efectivo' }); ui.success(`Venta ${v.numero} generada`); reload(); } }];
const cxcCols = [{ key: 'numero', label: 'Venta' }, { key: 'fecha', label: 'Fecha', type: 'date' }, { key: 'cliente_nombre', label: 'Cliente' }, { key: 'monto_total', label: 'Total', type: 'money' }, { key: 'saldo', label: 'Saldo', type: 'money' }, { key: 'fecha_vencimiento', label: 'Vence', type: 'date' }, { key: 'estado', label: 'Estado', type: 'badge' }];
const cxcActions = [{ label: 'Cobrar', icon: HandCoins, run: (r) => { pagoModal.value = { id: r.venta_id, saldo: r.saldo, numero: r.numero }; } }];
const cliCols = [{ key: 'nombre', label: 'Cliente', sortable: true }, { key: 'telefono', label: 'Teléfono' }, { key: 'email', label: 'Email' }, { key: 'compras', label: 'Compras', type: 'num' }, { key: 'saldo_pendiente', label: 'Saldo pendiente', type: 'money' }];
const cliFields = [{ key: 'nombre', label: 'Nombre / razón social', required: true }, { key: 'documento', label: 'NIT / CI' }, { key: 'telefono', label: 'Teléfono' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'direccion', label: 'Dirección' }, { key: 'consentimiento_contacto', label: 'Autoriza ser contactado (WhatsApp, etc.)', type: 'checkbox', full: true }, { key: 'notas', label: 'Notas', type: 'textarea' }];
const historial = ref(null); const cliActions = [{ label: 'Historial', run: async (r) => { historial.value = await api.get(`/clientes/${r.id}/historial`); } }];
const txCols = [{ key: 'fecha', label: 'Fecha', type: 'date' }, { key: 'numero', label: 'Venta' }, { key: 'cliente_nombre', label: 'Cliente' }, { key: 'monto', label: 'Monto', type: 'money' }, { key: 'metodo', label: 'Método' }, { key: 'referencia', label: 'Referencia' }];
onMounted(() => { if (route.query.nueva === '1' && auth.can(W) && tab.value === 'ventas') abrir('venta'); });
</script>

<template>
  <PageHead title="Ventas y clientes" subtitle="Ventas vinculadas a lotes de cosecha, pedidos, cuentas por cobrar y comprobantes.">
    <template v-if="auth.can(W)"><button class="btn" @click="abrir('pedido')"><Plus :size="16" />Nuevo pedido</button><button class="btn primary" @click="abrir('venta')"><Plus :size="16" />Nueva venta</button></template>
  </PageHead>
  <TabBar v-model="tab" :tabs="tabs" />

  <CrudView v-if="tab === 'ventas'" ref="crud" endpoint="/ventas" noun="venta" :write-perm="W" :columns="ventaCols" :fields="[]" :deletable="false" :row-actions="ventaActions" default-sort="fecha" date-filter hide-create
    :filters="[{ key: 'estado', label: 'Estado', options: [{ value: 'confirmada', label: 'Confirmada' }, { value: 'borrador', label: 'Borrador' }, { value: 'anulada', label: 'Anulada' }] }, { key: 'metodo_pago', label: 'Pago', options: METODOS_PAGO }, { key: 'cliente_id', label: 'Cliente', lookup: 'clientes' }]" />
  <CrudView v-else-if="tab === 'pedidos'" ref="crud" endpoint="/pedidos" noun="pedido" :write-perm="W" :columns="pedCols" :fields="[]" :row-actions="pedActions" default-sort="fecha" date-filter hide-create :filters="[{ key: 'estado', label: 'Estado', options: ['pendiente', 'confirmado', 'convertido', 'cancelado'].map(v => ({ value: v, label: v })) }]" />
  <CrudView v-else-if="tab === 'cxc'" endpoint="/cuentas-por-cobrar" noun="cuenta" plural="cuentas" :write-perm="W" :columns="cxcCols" :fields="[]" :deletable="false" :row-actions="cxcActions" hide-create :filters="[{ key: 'cliente_id', label: 'Cliente', lookup: 'clientes' }, { key: 'vencidas', label: 'Vencimiento', options: [{ value: '1', label: 'Solo vencidas' }] }]" />
  <CrudView v-else-if="tab === 'clientes'" endpoint="/clientes" noun="cliente" :write-perm="W" :columns="cliCols" :fields="cliFields" :row-actions="cliActions" default-sort="nombre" default-dir="asc" />
  <CrudView v-else endpoint="/ventas/transacciones" noun="transacción" plural="transacciones" :write-perm="W" :columns="txCols" :fields="[]" :deletable="false" hide-create date-filter default-sort="fecha" />

  <!-- Nueva venta / pedido -->
  <div v-if="modo" class="modal-back" @click.self="modo = null"><div class="modal wide">
    <div class="modal-head"><h2>{{ modo === 'venta' ? 'Nueva venta' : 'Nuevo pedido' }}</h2><button class="btn icon ghost" aria-label="Cerrar" @click="modo = null"><X :size="20" /></button></div>
    <div class="modal-body stack">
      <div class="form-grid"><div class="field"><label>Cliente *</label><select class="input" v-model="f.cliente_id"><option value="">Selecciona…</option><option v-for="c in clientes" :key="c.value" :value="c.value">{{ c.label }}</option></select></div>
        <div class="field"><label>Fecha</label><input class="input" type="date" v-model="f.fecha" /></div>
        <template v-if="modo === 'venta'"><div class="field"><label>Método de pago</label><select class="input" v-model="f.metodo_pago"><option v-for="m in METODOS_PAGO" :key="m.value" :value="m.value">{{ m.label }}</option></select></div>
          <div class="field"><label>Monto pagado ahora</label><input class="input" type="number" step="0.01" min="0" v-model="f.monto_pagado" :placeholder="f.metodo_pago === 'credito' ? '0 (por cobrar)' : 'Total'" /></div>
          <div v-if="f.metodo_pago === 'credito'" class="field"><label>Vencimiento</label><input class="input" type="date" v-model="f.fecha_vencimiento" /></div></template></div>
      <div><b>Productos</b><div class="callout info small" style="margin:6px 0">Los productos cosechados se asignan automáticamente a los lotes de cosecha comercializables más antiguos (trazabilidad).</div>
        <div v-for="(it, i) in f.items" :key="i" class="form-grid" style="grid-template-columns:2fr 1fr 1fr 1fr auto;align-items:end;margin-bottom:8px">
          <div class="field"><label v-if="!i">Producto</label><select class="input" v-model="it.ref" @change="pick(it)"><option value="">Selecciona…</option><option v-for="p in productos" :key="'p' + p.value" :value="'p:' + p.value">{{ p.label }}</option><option v-for="s in modo === 'venta' ? siembras : []" :key="'s' + s.value" :value="'s:' + s.value">{{ s.label }}</option></select></div>
          <div class="field"><label v-if="!i">Cantidad</label><input class="input" type="number" step="any" min="0" v-model="it.cantidad" /></div>
          <div class="field"><label v-if="!i">Precio unit.</label><input class="input" type="number" step="0.01" min="0" v-model="it.precio_unitario" /></div>
          <div class="field"><label v-if="!i">Descuento</label><input class="input" type="number" step="0.01" min="0" v-model="it.descuento" :disabled="modo === 'pedido'" /></div>
          <button class="btn icon danger" aria-label="Quitar" @click="f.items.splice(i, 1)" :disabled="f.items.length === 1"><Trash2 :size="16" /></button></div>
        <button class="btn sm" @click="f.items.push({ ref: '', cantidad: 1, precio_unitario: '', descuento: 0 })"><Plus :size="14" />Agregar línea</button></div>
      <div class="field"><label>Observaciones</label><input class="input" v-model="f.observaciones" /></div>
      <div class="row between"><b style="font-size:18px">Total: {{ M(total) }}</b></div>
      <div v-if="error" class="callout danger" role="alert">{{ error }}</div>
    </div>
    <div class="modal-foot"><button class="btn" @click="modo = null">Cancelar</button><button class="btn primary" :disabled="saving" @click="guardar"><span v-if="saving" class="spinner" />{{ modo === 'venta' ? 'Confirmar venta' : 'Guardar pedido' }}</button></div>
  </div></div>

  <FormModal v-if="pagoModal" :title="`Registrar cobro · ${pagoModal.numero}`" submit-text="Registrar cobro" :on-submit="cobrar" @close="pagoModal = null"
    :fields="[{ key: 'monto', label: `Monto (saldo ${fmtNum(pagoModal.saldo)})`, type: 'money', gt: 0, required: true, default: pagoModal.saldo }, { key: 'metodo', label: 'Método', type: 'select', options: METODOS_PAGO.filter(m => m.value !== 'credito'), default: 'efectivo' }, { key: 'fecha', label: 'Fecha', type: 'date', default: today }, { key: 'referencia', label: 'Referencia' }]" />

  <div v-if="detalle" class="modal-back" @click.self="detalle = null"><div class="modal wide"><div class="modal-head"><h2>Venta {{ detalle.numero }}</h2><button class="btn icon ghost" @click="detalle = null"><X :size="20" /></button></div><div class="modal-body stack">
    <dl class="kv"><dt>Cliente</dt><dd>{{ detalle.cliente_nombre }}</dd><dt>Fecha</dt><dd>{{ fmtDate(detalle.fecha) }}</dd><dt>Estado</dt><dd>{{ detalle.estado }}</dd><dt>Total / Pagado / Saldo</dt><dd>{{ M(detalle.total) }} / {{ M(detalle.pagado) }} / {{ M(detalle.saldo) }}</dd></dl>
    <table class="t"><thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">P. unit.</th><th class="num">Desc.</th><th class="num">Subtotal</th></tr></thead><tbody><tr v-for="d in detalle.detalle" :key="d.id"><td>{{ d.descripcion }}</td><td class="num">{{ fmtNum(d.cantidad) }}</td><td class="num">{{ M(d.precio_unitario) }}</td><td class="num">{{ M(d.descuento) }}</td><td class="num">{{ M(d.subtotal) }}</td></tr></tbody></table>
    <div v-if="detalle.pagos.length"><b>Pagos</b><ul class="list"><li v-for="p in detalle.pagos" :key="p.id">{{ fmtDate(p.fecha) }} · {{ M(p.monto) }} · {{ p.metodo }}</li></ul></div></div></div></div>
  <div v-if="historial" class="modal-back" @click.self="historial = null"><div class="modal wide"><div class="modal-head"><h2>{{ historial.cliente.nombre }}</h2><button class="btn icon ghost" @click="historial = null"><X :size="20" /></button></div><div class="modal-body stack">
    <div class="row"><span class="badge ok">Total comprado {{ M(historial.total_comprado) }}</span><span class="badge warn">Saldo pendiente {{ M(historial.saldo_pendiente) }}</span></div>
    <table class="t"><thead><tr><th>Venta</th><th>Fecha</th><th>Estado</th><th class="num">Total</th><th class="num">Saldo</th></tr></thead><tbody><tr v-for="v in historial.ventas" :key="v.id"><td>{{ v.numero }}</td><td>{{ fmtDate(v.fecha) }}</td><td>{{ v.estado }}</td><td class="num">{{ M(v.total) }}</td><td class="num">{{ M(v.saldo || 0) }}</td></tr></tbody></table></div></div></div>
</template>

