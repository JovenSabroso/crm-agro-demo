import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { createAppRouter } from './router/index.js';
import './styles/app.css';
import { registerSW } from 'virtual:pwa-register';

const app = createApp(App);
app.use(createPinia());
app.use(createAppRouter());
app.config.errorHandler = (err) => { console.error('[CRM-Agro] error no controlado:', err); };
app.mount('#app');
registerSW({ immediate: true });
