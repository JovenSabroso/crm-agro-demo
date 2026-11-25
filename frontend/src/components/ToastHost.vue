<script setup>
import { X, CircleCheck, TriangleAlert, CircleAlert } from 'lucide-vue-next';
import { useUi } from '../stores/ui.js';
const ui = useUi();
</script>

<template>
  <div class="toasts" role="status" aria-live="polite">
    <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="t.type">
      <CircleCheck v-if="t.type === 'ok'" :size="20" /><TriangleAlert v-else-if="t.type === 'warn'" :size="20" /><CircleAlert v-else :size="20" />
      <span>{{ t.message }}</span>
      <button class="x" aria-label="Cerrar" @click="ui.dismiss(t.id)"><X :size="16" /></button>
    </div>
  </div>
</template>
