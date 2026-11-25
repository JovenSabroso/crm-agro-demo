import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useUi = defineStore('ui', () => {
  const toasts = ref([]); const sidebarOpen = ref(false); const confirmState = ref(null);
  let n = 0;
  function toast(message, type = 'ok', ms = 4200) {
    const id = ++n; toasts.value.push({ id, message, type });
    if (ms) setTimeout(() => dismiss(id), ms);
    return id;
  }
  const dismiss = (id) => { toasts.value = toasts.value.filter(t => t.id !== id); };
  const success = (m) => toast(m, 'ok'); const error = (e) => toast(e?.message || String(e), 'error', 6500); const warn = (m) => toast(m, 'warn', 6000);
  /** Diálogo de confirmación promisificado */
  function confirm({ title = '¿Confirmar acción?', message = '', confirmText = 'Confirmar', danger = false } = {}) {
    return new Promise((resolve) => { confirmState.value = { title, message, confirmText, danger, resolve }; });
  }
  function answer(v) { confirmState.value?.resolve(v); confirmState.value = null; }
  return { toasts, sidebarOpen, confirmState, toast, dismiss, success, error, warn, confirm, answer };
});
