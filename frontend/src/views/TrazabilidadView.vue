<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ScanLine, Download, Printer, Link2, ExternalLink, ArrowLeft, ShieldCheck, ShieldAlert, Search, X } from 'lucide-vue-next';
import PageHead from '../components/PageHead.vue';
import QrScanner from '../components/QrScanner.vue';
import { api, downloadFile } from '../api/http.js';
import { useUi } from '../stores/ui.js';
import { useAuth } from '../stores/auth.js';
import { fmtDate, fmtNum, fmtMoney } from '../utils/format.js';

const route = useRoute(); const router = useRouter(); const ui = useUi(); const auth = useAuth();
const codigo = computed(() => route.params.codigo);
const lotes = ref([]); const meta = ref(null); const loading = ref(false); const q = ref(''); const filtro = ref(''); const page = ref(1);
const t = ref(null); const qr = ref(null); const scan = ref(false); const manual = ref(''); const printing = ref(false);
const CODE = /LC-\d{8}-[A-Z0-9]{6}/;

async function loadList() { loading.value = true; try { const r = await api.list('/trazabilidad/lotes', { q: q.value, comercializable: filtro.value, page: page.value, pageSize: 12 }); lotes.value = r.data; meta.value = r.meta; } catch (e) { ui.error(e); } finally { loading.value = false; } }
async function loadDetail() {
  t.value = null; qr.value = null;
  try { [t.value, qr.value] = await Promise.all([api.get(`/trazabilidad/lotes/${codigo.value}`), api.get(`/trazabilidad/lotes/${codigo.value}/qr`)]); } catch (e) { ui.error(e); router.replace('/trazabilidad'); }
}
let timer; watch([q, filtro], () => { clearTimeout(timer); timer = setTimeout(() => { page.value = 1; loadList(); }, 300); });
watch(codigo, (c) => { if (c) loadDetail(); else loadList(); });
onMounted(() => { if (codigo.value) loadDetail(); else { loadList(); if (route.query.escanear) scan.value = true; } });

function onCode(text) {
  const m = String(text).toUpperCase().match(CODE);
  scan.value = false;
  if (!m) return ui.error({ message: 'El código leído no corresponde a un lote de cosecha de CRM-Agro.' });
  router.push(`/trazabilidad/${m[0]}`);
}
const goManual = () => { if (manual.value.trim()) onCode(manual.value.trim()); };
const descargar = () => downloadFile(`/trazabilidad/lotes/${codigo.value}/qr.png`, { descargar: 1 }, `QR-${codigo.value}.png`).catch(ui.error);
async function imprimir() { printing.value = true; await nextTick(); window.print(); printing.value = false; }
async function copiar() { try { await navigator.clipboard.writeText(qr.value.url); ui.success('Enlace público copiado'); } catch { ui.warn(qr.value.url); } }
const publicPath = computed(() => `/t/${codigo.value}`);
</script>

<template>
  <!-- ============ DETALLE ============ -->
  <template v-if="codigo">
    <PageHead :title="`Lote de cosecha ${codigo}`" subtitle="Lote → Cultivo → Labores → Aplicaciones → Cosecha → Inventario → Venta → Cliente">
      <RouterLink to="/trazabilidad" class="btn"><ArrowLeft :size="16" />Volver</RouterLink>
    </PageHead>
    <div v-if="!t" class="card card-pad"><div class="skeleton" style="height:120px" /></div>
    <div v-else class="grid g-main">
      <div class="stack">
        <div class="card card-pad" :class="{ 'no-print': printing }">
          <div class="row between"><h3>{{ t.cultivo.nombre }} {{ t.cultivo.variedad }}</h3><span class="badge" :class="t.comercializable ? 'ok' : 'danger'"><ShieldCheck v-if="t.comercializable" :size="14" /><ShieldAlert v-else :size="14" />{{ t.comercializable ? 'Comercializable' : 'No comercializable' }}</span></div>
          <dl class="kv" style="margin-top:12px"><dt>Finca</dt><dd>{{ t.finca.nombre }}</dd><dt>Lote de campo</dt><dd>{{ t.lote.codigo }} · {{ t.lote.nombre }}</dd><dt>Siembra</dt><dd>{{ fmtDate(t.siembra.fecha) }}<span v-if="t.siembra.campana"> · {{ t.siembra.campana }}</span></dd>
            <dt>Cosecha</dt><dd>{{ fmtDate(t.cosecha.fecha) }} · <b>{{ fmtNum(t.cosecha.cantidad) }} {{ t.cosecha.unidad }}</b><span v-if="t.cosecha.responsable"> · {{ t.cosecha.responsable }}</span></dd>
            <dt>Inventario</dt><dd>Ingresado {{ fmtNum(t.inventario.ingresado) }} · Stock actual <b>{{ fmtNum(t.inventario.stock_actual) }}</b> {{ t.cosecha.unidad }}</dd>
            <dt>Comercialización</dt><dd>Vendido {{ fmtNum(t.comercializacion.vendido) }} {{ t.comercializacion.unidad }} en {{ t.comercializacion.ventas }} venta(s)</dd></dl>
          <div v-if="!t.carencia.cumple" class="callout danger" style="margin-top:12px"><b>Carencia incumplida:</b> <span v-for="a in t.carencia.incumplidas" :key="a.id">{{ a.producto_nombre }} (aplicado {{ fmtDate(a.fecha_aplicacion) }}, carencia hasta {{ fmtDate(a.fecha_fin_carencia) }}). </span></div>
        </div>
        <div class="card card-pad" :class="{ 'no-print': printing }"><h3 style="margin-bottom:14px">Historial de producción</h3>
          <ol class="timeline"><li v-for="(e, i) in t.linea_tiempo" :key="i" :class="e.etapa"><div class="when">{{ fmtDate(e.fecha) }} · {{ e.etapa }}</div><b>{{ e.titulo }}</b><div v-if="e.detalle" class="muted small">{{ e.detalle }}</div></li></ol></div>
        <div v-if="t.aplicaciones.length" class="card" :class="{ 'no-print': printing }"><div class="card-head"><h3>Aplicaciones fitosanitarias</h3></div><div class="table-wrap"><table class="t"><thead><tr><th>Fecha</th><th>Producto</th><th>Motivo</th><th>Carencia</th><th>Responsable</th></tr></thead><tbody><tr v-for="a in t.aplicaciones" :key="a.id"><td>{{ fmtDate(a.fecha_aplicacion) }}</td><td>{{ a.producto_nombre }}</td><td>{{ a.motivo }}</td><td>{{ a.periodo_carencia_dias }} d → {{ fmtDate(a.fecha_fin_carencia) }}</td><td>{{ a.responsable || '—' }}</td></tr></tbody></table></div></div>
        <div v-if="t.ventas.length" class="card" :class="{ 'no-print': printing }"><div class="card-head"><h3>Ventas y clientes</h3></div><div class="table-wrap"><table class="t"><thead><tr><th>Venta</th><th>Fecha</th><th>Cliente</th><th class="num">Cantidad</th><th class="num">Subtotal</th></tr></thead><tbody><tr v-for="v in t.ventas" :key="v.venta_id + v.cantidad"><td>{{ v.numero }}</td><td>{{ fmtDate(v.fecha) }}</td><td>{{ v.cliente }}</td><td class="num">{{ fmtNum(v.cantidad) }}</td><td class="num">{{ fmtMoney(v.subtotal, auth.moneda) }}</td></tr></tbody></table></div></div>
      </div>
      <div class="stack">
        <div class="card qr-card">
          <h3 style="margin-bottom:10px">Código QR del lote</h3>
          <img v-if="qr" :src="qr.dataUrl" :alt="`QR del lote ${codigo}`" />
          <div class="mono" style="margin:10px 0;font-weight:800;letter-spacing:.04em">{{ codigo }}</div>
          <div class="muted small" style="margin-bottom:12px">{{ t.cultivo.nombre }} · {{ fmtDate(t.cosecha.fecha) }} · {{ fmtNum(t.cosecha.cantidad) }} {{ t.cosecha.unidad }}</div>
          <div class="row no-print" style="justify-content:center"><button class="btn sm" @click="descargar"><Download :size="15" />Descargar</button><button class="btn sm" @click="imprimir"><Printer :size="15" />Imprimir</button><button class="btn sm" @click="copiar"><Link2 :size="15" />Copiar enlace</button></div>
          <RouterLink :to="publicPath" target="_blank" class="btn sm no-print" style="margin-top:10px"><ExternalLink :size="15" />Ver ficha pública</RouterLink>
          <p class="muted small no-print" style="margin:12px 0 0">Al escanear el QR, el cliente ve la ficha pública sin datos internos ni de trabajadores.</p>
        </div>
      </div>
    </div>
  </template>

  <!-- ============ LISTA ============ -->
  <template v-else>
    <PageHead title="Trazabilidad" subtitle="Cada cosecha genera un lote con código único y QR. Consulta su historial completo o escanea un código.">
      <button class="btn primary" @click="scan = true"><ScanLine :size="18" />Escanear QR</button>
    </PageHead>
    <div class="card">
      <div class="toolbar">
        <div class="field grow"><label class="sr-only">Buscar</label><input class="input" type="search" v-model="q" placeholder="Buscar por código, lote o cultivo…" /></div>
        <div class="field"><label>Estado</label><select class="input" v-model="filtro"><option value="">Todos</option><option value="1">Comercializable</option><option value="0">Retenida</option></select></div>
        <div class="field"><label>Código manual</label><div class="row" style="flex-wrap:nowrap"><input class="input" v-model="manual" placeholder="LC-20261125-ABC123" @keyup.enter="goManual" /><button class="btn icon" aria-label="Buscar código" @click="goManual"><Search :size="16" /></button></div></div>
      </div>
      <div class="table-wrap"><table class="t stack-sm"><thead><tr><th>Código</th><th>Cultivo</th><th>Lote</th><th>Cosecha</th><th class="num">Cantidad</th><th class="num">Stock</th><th class="num">Vendido</th><th>Estado</th></tr></thead>
        <tbody><tr v-if="loading && !lotes.length"><td colspan="8"><div class="skeleton" /></td></tr>
          <tr v-for="l in lotes" :key="l.id" style="cursor:pointer" @click="router.push(`/trazabilidad/${l.codigo}`)"><td data-label="Código" class="mono"><b>{{ l.codigo }}</b></td><td data-label="Cultivo">{{ l.cultivo }} {{ l.variedad }}</td><td data-label="Lote">{{ l.lote_codigo }}</td><td data-label="Cosecha">{{ fmtDate(l.fecha) }}</td><td data-label="Cantidad" class="num">{{ fmtNum(l.cantidad) }} {{ l.unidad }}</td><td data-label="Stock" class="num">{{ fmtNum(l.stock) }}</td><td data-label="Vendido" class="num">{{ fmtNum(l.vendido) }}</td><td data-label="Estado"><span class="badge" :class="l.comercializable ? 'ok' : 'warn'">{{ l.comercializable ? 'Comercializable' : 'Retenida' }}</span></td></tr></tbody></table>
        <div v-if="!loading && !lotes.length" class="empty">Aún no hay lotes de cosecha. Registra una cosecha en Control de campo.</div></div>
      <div v-if="meta && meta.totalPages > 1" class="pager"><span>{{ meta.total }} lotes</span><div class="row"><button class="btn sm" :disabled="page <= 1" @click="page--; loadList()">Anterior</button><span>{{ page }} / {{ meta.totalPages }}</span><button class="btn sm" :disabled="page >= meta.totalPages" @click="page++; loadList()">Siguiente</button></div></div>
    </div>
  </template>

  <div v-if="scan" class="modal-back" @click.self="scan = false"><div class="modal sm"><div class="modal-head"><h2>Escanear código QR</h2><button class="btn icon ghost" aria-label="Cerrar" @click="scan = false"><X :size="20" /></button></div><div class="modal-body"><QrScanner @code="onCode" /></div></div></div>
</template>
