<script setup>
defineProps({ label: String, value: [String, Number], sub: String, tone: { type: String, default: '' }, icon: Object, to: String });
</script>

<template>
  <component :is="to ? 'RouterLink' : 'div'" :to="to" class="card kpi" :class="[tone, { link: to }]" style="display:block;color:inherit;text-decoration:none">
    <div class="chip"><component :is="icon" v-if="icon" :size="20" /></div>
    <div class="label">{{ label }}</div>
    <div class="value">{{ value }}</div>
    <div v-if="sub" class="sub">{{ sub }}</div>
    <slot />
  </component>
</template>
