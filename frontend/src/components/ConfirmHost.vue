<script setup>
import { useUi } from '../stores/ui.js';
const ui = useUi();
</script>

<template>
  <div v-if="ui.confirmState" class="modal-back" @click.self="ui.answer(false)" @keydown.esc="ui.answer(false)">
    <div class="modal sm" role="alertdialog" aria-modal="true">
      <div class="modal-head"><h2>{{ ui.confirmState.title }}</h2></div>
      <div v-if="ui.confirmState.message" class="modal-body"><p style="margin:0">{{ ui.confirmState.message }}</p></div>
      <div class="modal-foot">
        <button class="btn" @click="ui.answer(false)">Cancelar</button>
        <button class="btn" :class="ui.confirmState.danger ? 'danger' : 'primary'" autofocus @click="ui.answer(true)">{{ ui.confirmState.confirmText }}</button>
      </div>
    </div>
  </div>
</template>
