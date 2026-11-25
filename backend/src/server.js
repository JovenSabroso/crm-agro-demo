import { createApp, whatsapp } from './app.js';
import { config } from './config/env.js';

const app = createApp();
const server = app.listen(config.port, () => {
  whatsapp?.iniciar();
  console.log(`CRM-Agro API escuchando en http://localhost:${config.port}  (entorno: ${config.env})`);
  console.log(`Swagger: http://localhost:${config.port}/api/docs`);
});

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, async () => { await whatsapp?.detener(); server.close(() => process.exit(0)); });
}
