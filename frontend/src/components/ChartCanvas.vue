<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);
Chart.defaults.font.family = "'Manrope Variable', system-ui, sans-serif";
Chart.defaults.color = '#6c766e';
Chart.defaults.borderColor = '#e9e4d4';

/** Gráfico Chart.js reactivo. props.type: bar|line|doughnut|pie; props.data: { labels, datasets } */
const props = defineProps({ type: { type: String, default: 'bar' }, data: { type: Object, required: true }, options: { type: Object, default: () => ({}) }, small: Boolean });
const canvas = ref(null);
let chart;

function build() {
  chart?.destroy();
  if (!canvas.value) return;
  const circular = ['doughnut', 'pie'].includes(props.type);
  chart = new Chart(canvas.value, {
    type: props.type, data: JSON.parse(JSON.stringify(props.data)),
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 650, easing: 'easeOutQuart' }, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: circular ? 'right' : 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 14 } }, tooltip: { backgroundColor: '#0f2d1b', padding: 10, cornerRadius: 8, titleFont: { weight: '700' } } },
      scales: circular ? {} : { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: '#eee9d9' }, border: { display: false } } },
      ...props.options,
    },
  });
}
onMounted(build);
watch(() => props.data, build, { deep: true });
onBeforeUnmount(() => chart?.destroy());
</script>

<template><div class="chart-box" :class="{ sm: small }"><canvas ref="canvas" role="img" aria-label="Gráfico" /></div></template>
