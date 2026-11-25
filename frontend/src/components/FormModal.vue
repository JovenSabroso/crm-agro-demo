<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { X } from 'lucide-vue-next';
import { loadLookup, LK } from '../utils/lookups.js';
import { ApiError } from '../api/http.js';

/**
 * Formulario modal dirigido por configuración.
 * fields: [{ key, label, type: text|number|money|date|time|select|textarea|checkbox|email|password, required, options, lookup, default, hint, full, min, max, step, placeholder, showIf(form), disabled }]
 * onSubmit(payload) debe devolver una promesa; los errores de validación del servidor se muestran junto a cada campo.
 */
const props = defineProps({
  title: String, fields: { type: Array, required: true }, initial: { type: Object, default: () => ({}) },
  submitText: { type: String, default: 'Guardar' }, onSubmit: { type: Function, required: true }, wide: Boolean, hint: String,
});
const emit = defineEmits(['close', 'saved']);

const form = reactive({}); const errors = reactive({}); const options = reactive({}); const saving = ref(false); const formError = ref('');
const isEdit = props.initial?.id !== undefined;
const isReq = (f) => f.required || (f.requiredOnCreate && !isEdit);
const isOff = (f) => f.disabled || (f.lockOnEdit && isEdit);
const visible = computed(() => props.fields.filter(f => !f.showIf || f.showIf(form)));

for (const f of props.fields) form[f.key] = props.initial[f.key] ?? (f.default !== undefined ? (typeof f.default === 'function' ? f.default() : f.default) : f.type === 'checkbox' ? false : '');
if (props.initial.id !== undefined) for (const f of props.fields) if (f.type === 'checkbox') form[f.key] = !!props.initial[f.key];

onMounted(async () => {
  for (const f of props.fields) {
    if (f.options) options[f.key] = f.options;
    else if (f.lookup) {
      const def = typeof f.lookup === 'string' ? LK[f.lookup] : f.lookup;
      try { options[f.key] = await loadLookup(def.endpoint, { params: def.params, label: def.label }); } catch { options[f.key] = []; }
      // si el valor inicial está vacío y es requerido con una sola opción, se preselecciona
      if (f.required && !form[f.key] && options[f.key].length === 1) form[f.key] = options[f.key][0].value;
    }
  }
});
watch(form, () => { for (const k of Object.keys(errors)) delete errors[k]; formError.value = ''; }, { deep: true, flush: 'sync' });

function clientValidate() {
  const e = {};
  for (const f of visible.value) {
    const v = form[f.key];
    const empty = v === '' || v === null || v === undefined;
    if (isReq(f) && f.type !== 'checkbox' && empty) e[f.key] = 'Este campo es obligatorio';
    else if (!empty && ['number', 'money'].includes(f.type)) {
      const n = Number(v);
      if (Number.isNaN(n)) e[f.key] = 'Debe ser un número';
      else if (f.min !== undefined && n < f.min) e[f.key] = `Debe ser ≥ ${f.min}`;
      else if (f.max !== undefined && n > f.max) e[f.key] = `Debe ser ≤ ${f.max}`;
      else if (f.gt !== undefined && n <= f.gt) e[f.key] = `Debe ser mayor que ${f.gt}`;
    } else if (!empty && f.type === 'email' && !/^\S+@\S+\.\S+$/.test(v)) e[f.key] = 'Email inválido';
    else if (!empty && f.type === 'password' && f.checkStrength && !(String(v).length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v))) e[f.key] = 'Mínimo 8 caracteres con letras y números';
  }
  Object.assign(errors, e); return Object.keys(e).length === 0;
}
function payload() {
  const out = {};
  for (const f of visible.value) {
    let v = form[f.key];
    if (f.type === 'checkbox') v = !!v;
    else if (v === '' || v === undefined) v = isReq(f) ? v : null;
    else if (['number', 'money'].includes(f.type) || (f.lookup && v !== null)) v = typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
    if (f.skipEmpty && (v === null || v === '')) continue;
    out[f.key] = v;
  }
  return out;
}
async function submit() {
  if (!clientValidate()) { formError.value = 'Revisa los campos marcados.'; return; }
  saving.value = true; formError.value = '';
  try { const r = await props.onSubmit(payload()); emit('saved', r); emit('close'); }
  catch (e) {
    if (e instanceof ApiError && Object.keys(e.fieldErrors).length) Object.assign(errors, e.fieldErrors);
    formError.value = e.message;
  } finally { saving.value = false; }
}
</script>

<template>
  <div class="modal-back" @click.self="emit('close')" @keydown.esc="emit('close')">
    <form class="modal" :class="{ wide }" novalidate @submit.prevent="submit" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>{{ title }}</h2><button type="button" class="btn icon ghost" aria-label="Cerrar" @click="emit('close')"><X :size="20" /></button></div>
      <div class="modal-body">
        <p v-if="hint" class="callout info small" style="margin-top:0">{{ hint }}</p>
        <slot name="top" :form="form" />
        <div class="form-grid">
          <div v-for="f in visible" :key="f.key" class="field" :class="[{ invalid: errors[f.key], full: f.full || f.type === 'textarea' }]">
            <label v-if="f.type !== 'checkbox'" :for="'f-' + f.key">{{ f.label }}<span v-if="isReq(f)" class="req"> *</span></label>
            <label v-else class="check"><input :id="'f-' + f.key" type="checkbox" v-model="form[f.key]" :disabled="isOff(f)" />{{ f.label }}</label>
            <textarea v-if="f.type === 'textarea'" :id="'f-' + f.key" class="input" v-model="form[f.key]" :placeholder="f.placeholder" :disabled="isOff(f)" />
            <select v-else-if="f.type === 'select'" :id="'f-' + f.key" class="input" v-model="form[f.key]" :disabled="isOff(f)">
              <option value="">{{ isReq(f) ? 'Selecciona…' : '— Ninguno —' }}</option>
              <option v-for="o in options[f.key] || []" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <input v-else-if="f.type !== 'checkbox'" :id="'f-' + f.key" class="input" :type="f.type === 'money' ? 'number' : (f.type || 'text')" :inputmode="['number', 'money'].includes(f.type) ? 'decimal' : undefined"
              :step="f.step ?? (f.type === 'money' ? '0.01' : f.type === 'number' ? 'any' : undefined)" v-model="form[f.key]" :placeholder="f.placeholder" :disabled="isOff(f)" :autocomplete="f.type === 'password' ? 'new-password' : 'off'" />
            <span v-if="errors[f.key]" class="err" role="alert">{{ errors[f.key] }}</span>
            <span v-else-if="f.hint" class="hint">{{ f.hint }}</span>
          </div>
        </div>
        <slot :form="form" />
        <div v-if="formError" class="callout danger" role="alert" style="margin-top:14px">{{ formError }}</div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" @click="emit('close')">Cancelar</button>
        <button type="submit" class="btn primary" :disabled="saving"><span v-if="saving" class="spinner" />{{ submitText }}</button>
      </div>
    </form>
  </div>
</template>
