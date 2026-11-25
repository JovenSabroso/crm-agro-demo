<script setup>
import { useRoute, useRouter } from 'vue-router';
/** Pestañas sincronizadas con ?tab= para poder enlazar y recargar sin perder la sección. */
const props = defineProps({ tabs: { type: Array, required: true }, modelValue: String });
const emit = defineEmits(['update:modelValue']);
const route = useRoute(); const router = useRouter();
function pick(k) { emit('update:modelValue', k); router.replace({ query: { ...route.query, tab: k, nueva: undefined } }); }
</script>

<template>
  <div class="tabs" role="tablist">
    <button v-for="t in tabs" :key="t.key" role="tab" :aria-selected="modelValue === t.key" :class="{ active: modelValue === t.key }" @click="pick(t.key)">{{ t.label }}</button>
  </div>
</template>
