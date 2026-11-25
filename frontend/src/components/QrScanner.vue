<script setup>
import { onBeforeUnmount, ref } from 'vue';
import jsQR from 'jsqr';
import { Camera, ImageUp, X } from 'lucide-vue-next';

/** Lectura de códigos QR: cámara en vivo (getUserMedia) o imagen. Emite `code` con el texto leído (URL o código). */
const emit = defineEmits(['code', 'close']);
const video = ref(null); const active = ref(false); const msg = ref(''); let stream; let raf;
const canvas = document.createElement('canvas');

function scan() {
  const v = video.value;
  if (!v || !active.value) return;
  if (v.readyState === v.HAVE_ENOUGH_DATA) {
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(v, 0, 0);
    const r = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    if (r?.data) { stop(); emit('code', r.data); return; }
  }
  raf = requestAnimationFrame(scan);
}
async function start() {
  msg.value = '';
  if (!navigator.mediaDevices?.getUserMedia) { msg.value = 'Este navegador no permite usar la cámara (se requiere HTTPS o localhost). Sube una imagen del QR.'; return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
    active.value = true; await new Promise(r => setTimeout(r, 30)); video.value.srcObject = stream; await video.value.play(); scan();
  } catch (e) { msg.value = 'No se pudo acceder a la cámara: ' + (e.message || e.name); }
}
function stop() { active.value = false; cancelAnimationFrame(raf); stream?.getTracks().forEach(t => t.stop()); stream = null; }
function fromFile(e) {
  const file = e.target.files?.[0]; if (!file) return;
  const img = new Image(); img.onload = () => {
    canvas.width = img.width; canvas.height = img.height; const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    const r = jsQR(ctx.getImageData(0, 0, img.width, img.height).data, img.width, img.height);
    if (r?.data) emit('code', r.data); else msg.value = 'No se detectó ningún código QR en la imagen.';
  };
  img.src = URL.createObjectURL(file);
}
onBeforeUnmount(stop);
</script>

<template>
  <div class="scanner stack">
    <div class="row">
      <button class="btn primary" v-if="!active" @click="start"><Camera :size="18" />Usar cámara</button>
      <button class="btn" v-else @click="stop"><X :size="18" />Detener</button>
      <label class="btn"><ImageUp :size="18" />Subir imagen<input type="file" accept="image/*" hidden @change="fromFile" /></label>
    </div>
    <video v-show="active" ref="video" playsinline muted />
    <div v-if="msg" class="callout">{{ msg }}</div>
  </div>
</template>
