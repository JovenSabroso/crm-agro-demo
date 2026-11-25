<script setup>
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import PageHead from '../components/PageHead.vue';
import TabBar from '../components/TabBar.vue';
import CrudView from '../components/CrudView.vue';
import { CATEGORIAS_PRODUCTO, fmtNum, today } from '../utils/format.js';

const route = useRoute();
const tabs = [{ key: 'productos', label: 'Productos y existencias' }, { key: 'movimientos', label: 'Movimientos' }, { key: 'proveedores', label: 'Proveedores' }];
const tab = ref(tabs.find(t => t.key === route.query.tab)?.key || 'productos');
const W = 'inventario:write';
const prodCols = [{ key: 'nombre', label: 'Producto', sortable: true }, { key: 'categoria', label: 'Categoría', type: 'badge', sortable: true }, { key: 'stock_actual', label: 'Stock', format: r => `${fmtNum(r.stock_actual)} ${r.unidad}`, sortable: true, sortKey: 'stock' }, { key: 'stock_minimo', label: 'Mínimo', type: 'num' },
  { key: 'costo_promedio', label: 'Costo prom.', type: 'money' }, { key: 'precio_venta', label: 'Precio venta', type: 'money' }, { key: 'alerta', label: 'Alerta', format: r => (r.bajo_stock ? '⚠ Stock bajo' : 'OK') }];
const prodFields = [{ key: 'categoria', label: 'Categoría', type: 'select', options: CATEGORIAS_PRODUCTO, required: true, lockOnEdit: true }, { key: 'nombre', label: 'Nombre', required: true }, { key: 'unidad', label: 'Unidad de medida', required: true, default: 'kg', hint: 'kg, L, sobre, u…' },
  { key: 'stock_minimo', label: 'Stock mínimo (alerta)', type: 'number', min: 0, default: 0 }, { key: 'precio_venta', label: 'Precio de venta', type: 'money', min: 0 }, { key: 'proveedor_id', label: 'Proveedor', type: 'select', lookup: 'proveedores' },
  { key: 'periodo_carencia_dias', label: 'Carencia según etiqueta (días)', type: 'number', min: 0, hint: 'Solo agroquímicos.' }, { key: 'etiqueta_info', label: 'Información de etiqueta (transcrita)', type: 'textarea', hint: 'El sistema no recomienda dosis.' },
  { key: 'stock_inicial', label: 'Existencia inicial (solo al crear)', type: 'number', min: 0, skipEmpty: true }, { key: 'costo_unitario', label: 'Costo unitario inicial', type: 'money', min: 0, skipEmpty: true }];
const movCols = [{ key: 'fecha', label: 'Fecha', type: 'date', sortable: true }, { key: 'producto_nombre', label: 'Producto' }, { key: 'tipo', label: 'Tipo', type: 'badge' }, { key: 'motivo', label: 'Motivo' }, { key: 'delta', label: 'Variación', format: r => `${r.delta > 0 ? '+' : ''}${fmtNum(r.delta)} ${r.unidad}` }, { key: 'stock_resultante', label: 'Stock resultante', type: 'num' }, { key: 'costo_unitario', label: 'Costo unit.', type: 'money' }, { key: 'lote_cosecha_codigo', label: 'Lote cosecha' }];
const movFields = [{ key: 'producto_id', label: 'Producto', type: 'select', lookup: 'productos', required: true }, { key: 'tipo', label: 'Tipo de movimiento', type: 'select', required: true, default: 'entrada', options: [{ value: 'entrada', label: 'Entrada (compra, devolución)' }, { value: 'salida', label: 'Salida (consumo, merma)' }, { value: 'ajuste', label: 'Ajuste de inventario' }] },
  { key: 'cantidad', label: 'Cantidad', type: 'number', gt: 0, showIf: f => f.tipo !== 'ajuste', required: true }, { key: 'cantidad_real', label: 'Cantidad real contada', type: 'number', min: 0, showIf: f => f.tipo === 'ajuste', required: true },
  { key: 'motivo', label: 'Motivo', type: 'select', options: ['compra', 'devolucion', 'donacion', 'consumo', 'merma', 'otro'].map(v => ({ value: v, label: v })), showIf: f => f.tipo !== 'ajuste', hint: 'Entradas: compra/devolución/donación/otro. Salidas: consumo/merma/otro.' },
  { key: 'costo_unitario', label: 'Costo unitario', type: 'money', min: 0, showIf: f => f.tipo === 'entrada' }, { key: 'proveedor_id', label: 'Proveedor', type: 'select', lookup: 'proveedores', showIf: f => f.tipo === 'entrada' }, { key: 'lote_id', label: 'Lote de campo (consumo)', type: 'select', lookup: 'lotes', showIf: f => f.tipo === 'salida' },
  { key: 'fecha', label: 'Fecha', type: 'date', default: today }, { key: 'observaciones', label: 'Observaciones', type: 'textarea' }];
const movBefore = (p) => { const o = { ...p }; for (const k of Object.keys(o)) if (o[k] === null) delete o[k]; return o; };
const provCols = [{ key: 'nombre', label: 'Proveedor', sortable: true }, { key: 'contacto', label: 'Contacto' }, { key: 'telefono', label: 'Teléfono' }, { key: 'email', label: 'Email' }];
const provFields = [{ key: 'nombre', label: 'Nombre', required: true }, { key: 'contacto', label: 'Contacto' }, { key: 'telefono', label: 'Teléfono' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'direccion', label: 'Dirección' }];
</script>

<template>
  <PageHead title="Inventarios" subtitle="Semillas, fertilizantes, agroquímicos, herramientas, materiales, productos cosechados y plantines." />
  <TabBar v-model="tab" :tabs="tabs" />
  <CrudView v-if="tab === 'productos'" endpoint="/productos" noun="producto" :write-perm="W" :columns="prodCols" :fields="prodFields" default-sort="nombre" default-dir="asc" :auto-create="route.query.nueva === '1'"
    :filters="[{ key: 'categoria', label: 'Categoría', options: CATEGORIAS_PRODUCTO }, { key: 'bajo_stock', label: 'Stock', default: route.query.bajo ? '1' : '', options: [{ value: '1', label: 'Solo stock bajo' }] }]" hint="Las existencias solo cambian mediante movimientos (entradas, salidas, ajustes) para conservar el historial. Los productos cosechados ingresan desde una cosecha." />
  <CrudView v-else-if="tab === 'movimientos'" endpoint="/inventario/movimientos" noun="movimiento" :write-perm="W" :columns="movCols" :fields="movFields" :editable="false" :deletable="false" default-sort="fecha" date-filter :before-submit="movBefore" :auto-create="route.query.nueva === '1'" create-text="Registrar movimiento"
    :filters="[{ key: 'producto_id', label: 'Producto', lookup: 'productos' }, { key: 'tipo', label: 'Tipo', options: [{ value: 'entrada', label: 'Entradas' }, { value: 'salida', label: 'Salidas' }, { value: 'ajuste', label: 'Ajustes' }] }]" />
  <CrudView v-else endpoint="/proveedores" noun="proveedor" :write-perm="W" :columns="provCols" :fields="provFields" default-sort="nombre" default-dir="asc" />
</template>
