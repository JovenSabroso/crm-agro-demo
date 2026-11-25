<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import L from 'leaflet';

/**
 * Mapa Leaflet. markers: [{ lat, lng, label, color }]. Si `pick` es true permite tocar el mapa para elegir una coordenada (emite update:point).
 * Se usan círculos vectoriales (no imágenes de marcador) para que funcione igual en la PWA y sin conexión de iconos.
 */
const props = defineProps({ markers: { type: Array, default: () => [] }, point: Object, pick: Boolean, center: Array, zoom: { type: Number, default: 14 } });
const emit = defineEmits(['update:point']);
const el = ref(null); let map; let layer; let picked;

function draw() {
  layer?.clearLayers();
  const pts = [];
  for (const m of props.markers) if (m.lat != null && m.lng != null) {
    L.circleMarker([m.lat, m.lng], { radius: 9, color: '#fff', weight: 2, fillColor: m.color || '#2f7a47', fillOpacity: .95 }).bindTooltip(m.label || '', { permanent: !!m.permanent, direction: 'top' }).addTo(layer); pts.push([m.lat, m.lng]);
  }
  if (props.point?.lat != null) { picked?.remove(); picked = L.circleMarker([props.point.lat, props.point.lng], { radius: 10, color: '#fff', weight: 3, fillColor: '#e0a030', fillOpacity: 1 }).addTo(map); pts.push([props.point.lat, props.point.lng]); }
  if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30], maxZoom: 17 }); else if (pts.length === 1) map.setView(pts[0], props.zoom);
}
onMounted(() => {
  map = L.map(el.value, { scrollWheelZoom: false }).setView(props.center || [-16.5, -68.15], props.zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  layer = L.layerGroup().addTo(map);
  if (props.pick) map.on('click', (e) => emit('update:point', { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }));
  draw(); setTimeout(() => map.invalidateSize(), 200);
});
watch(() => [props.markers, props.point], () => map && draw(), { deep: true });
onBeforeUnmount(() => map?.remove());
</script>

<template><div ref="el" class="map" role="region" aria-label="Mapa de lotes" /></template>
